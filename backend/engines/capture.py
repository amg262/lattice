"""
Packet capture engine.

Uses scapy on top of Npcap (Windows) to sniff all traffic on the selected
interface. Parsed connection events are pushed into an asyncio.Queue so the
WebSocket broadcaster can relay them to the frontend in real-time.

New features:
  - DNS query name extraction → dns_log table + live spy feed
  - TLS SNI extraction from ClientHello handshakes → dns_log
  - HTTP Host + path extraction from plaintext requests → dns_log
  - Flow-level deduplication before DB writes (one row per unique flow per 60 s)
  - Batched DB writes every 5 seconds via background thread
  - Traffic spike detection → alerts engine
"""
from __future__ import annotations
import asyncio
import collections
import logging
import threading
import time
from datetime import datetime, timezone

import config
import db.queries as q
from models.schemas import Connection, TrafficPoint

log = logging.getLogger("lattice.capture")

# ---------------------------------------------------------------------------
# Asyncio event queue (read by WebSocket broadcaster)
# ---------------------------------------------------------------------------
_event_queue: asyncio.Queue | None = None

# ---------------------------------------------------------------------------
# In-memory ring buffers
# ---------------------------------------------------------------------------
_recent_connections: collections.deque[Connection] = collections.deque(
    maxlen=config.MAX_CONNECTIONS_HISTORY
)
_connections_lock = threading.Lock()

_dns_recent: collections.deque[dict] = collections.deque(maxlen=200)
_dns_recent_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Traffic accumulators (flushed to DB every 60 s)
# ---------------------------------------------------------------------------
_traffic_acc: dict[tuple, dict] = collections.defaultdict(
    lambda: {"bytes_out": 0, "bytes_in": 0, "packets_out": 0, "packets_in": 0}
)
_traffic_lock = threading.Lock()

# Protocol counter (reset on demand)
_proto_counts: dict[str, int] = collections.defaultdict(int)
_proto_lock = threading.Lock()

# ---------------------------------------------------------------------------
# DB write queues (drained by background thread every 5 s)
# ---------------------------------------------------------------------------
_conn_write_queue: list[Connection] = []
_conn_queue_lock = threading.Lock()

_dns_write_queue: list[dict] = []
_dns_queue_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Deduplication state
# ---------------------------------------------------------------------------
# Flow dedup: only persist a (src, dst, dport, proto) flow once per 60 s
_flow_seen: dict[tuple, float] = {}
_flow_lock = threading.Lock()
FLOW_DEDUP_SECONDS = 60

# DNS dedup: only persist (src_ip, domain) once per 5 min
_dns_seen: dict[tuple, float] = {}
_dns_lock = threading.Lock()
DNS_DEDUP_SECONDS = 300


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------

def set_event_queue(queue: asyncio.Queue) -> None:
    global _event_queue
    _event_queue = queue


def get_recent_connections(limit: int = 50) -> list[Connection]:
    with _connections_lock:
        items = list(_recent_connections)
    return list(reversed(items))[:limit]


def get_recent_dns(limit: int = 50) -> list[dict]:
    with _dns_recent_lock:
        items = list(_dns_recent)
    return list(reversed(items))[:limit]


def get_protocol_counts() -> dict[str, int]:
    with _proto_lock:
        return dict(_proto_counts)


def reset_protocol_counts() -> None:
    with _proto_lock:
        _proto_counts.clear()


# ---------------------------------------------------------------------------
# Protocol classifier
# ---------------------------------------------------------------------------

def _classify_protocol(pkt) -> str:
    from scapy.layers.inet import TCP, UDP, ICMP
    from scapy.layers.dns import DNS

    if pkt.haslayer(DNS):
        return "DNS"
    if pkt.haslayer(TCP):
        sport, dport = pkt[TCP].sport, pkt[TCP].dport
        if 443 in (sport, dport):
            return "TLS"
        if 80 in (sport, dport):
            return "HTTP"
        if 22 in (sport, dport):
            return "SSH"
        if 25 in (sport, dport) or 587 in (sport, dport):
            return "SMTP"
        if 3306 in (sport, dport):
            return "MySQL"
        if 5432 in (sport, dport):
            return "PostgreSQL"
        if 6379 in (sport, dport):
            return "Redis"
        return "TCP"
    if pkt.haslayer(UDP):
        sport, dport = pkt[UDP].sport, pkt[UDP].dport
        if 53 in (sport, dport):
            return "DNS"
        if 67 in (sport, dport) or 68 in (sport, dport):
            return "DHCP"
        if 123 in (sport, dport):
            return "NTP"
        return "UDP"
    if pkt.haslayer(ICMP):
        return "ICMP"
    return "Other"


# ---------------------------------------------------------------------------
# Deep-inspection extractors
# ---------------------------------------------------------------------------

def _extract_dns_query(pkt) -> str | None:
    """Return the queried domain name from a DNS query packet, or None."""
    try:
        from scapy.layers.dns import DNS, DNSQR
        if pkt.haslayer(DNS) and pkt[DNS].qr == 0 and pkt.haslayer(DNSQR):
            raw = pkt[DNSQR].qname
            if isinstance(raw, bytes):
                return raw.decode("ascii", errors="replace").rstrip(".")
            return str(raw).rstrip(".")
    except Exception:
        pass
    return None


def _extract_tls_sni(payload: bytes) -> str | None:
    """Parse a TLS ClientHello and return the SNI hostname, or None."""
    try:
        if len(payload) < 5:
            return None
        # TLS record: content_type=0x16 (handshake), version, length
        if payload[0] != 0x16:
            return None
        record_len = int.from_bytes(payload[3:5], "big")
        if len(payload) < 5 + record_len:
            return None
        hs = payload[5:]
        # Handshake type 0x01 = ClientHello
        if not hs or hs[0] != 0x01:
            return None
        # Skip handshake type (1) + length (3)
        hello = hs[4:]
        # Skip ProtocolVersion (2) + Random (32)
        pos = 34
        if pos >= len(hello):
            return None
        # Skip Session ID
        sid_len = hello[pos]
        pos += 1 + sid_len
        # Skip Cipher Suites
        if pos + 2 > len(hello):
            return None
        cs_len = int.from_bytes(hello[pos : pos + 2], "big")
        pos += 2 + cs_len
        # Skip Compression Methods
        if pos >= len(hello):
            return None
        cm_len = hello[pos]
        pos += 1 + cm_len
        # Extensions
        if pos + 2 > len(hello):
            return None
        ext_total = int.from_bytes(hello[pos : pos + 2], "big")
        pos += 2
        ext_end = pos + ext_total
        while pos + 4 <= ext_end and pos + 4 <= len(hello):
            ext_type = int.from_bytes(hello[pos : pos + 2], "big")
            ext_len = int.from_bytes(hello[pos + 2 : pos + 4], "big")
            pos += 4
            if ext_type == 0x0000:  # SNI
                # server_name_list_length (2)
                if pos + 2 > len(hello):
                    break
                pos += 2  # skip list length
                # name_type (1) + name_length (2)
                if pos + 3 > len(hello):
                    break
                name_type = hello[pos]
                name_len = int.from_bytes(hello[pos + 1 : pos + 3], "big")
                pos += 3
                if name_type == 0x00 and pos + name_len <= len(hello):
                    return hello[pos : pos + name_len].decode("ascii", errors="replace")
                break
            pos += ext_len
    except Exception:
        pass
    return None


def _extract_http_host(payload: bytes) -> tuple[str, str] | None:
    """Return (host, path) from an HTTP request payload, or None."""
    try:
        text = payload[:2048].decode("utf-8", errors="replace")
        lines = text.split("\r\n")
        if not lines:
            return None
        first = lines[0]
        if not any(first.startswith(m) for m in ("GET ", "POST ", "HEAD ", "PUT ")):
            return None
        parts = first.split(" ")
        path = parts[1] if len(parts) > 1 else "/"
        host = ""
        for line in lines[1:]:
            if line.lower().startswith("host:"):
                host = line[5:].strip()
                break
        if host:
            return host, path
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Dedup helpers
# ---------------------------------------------------------------------------

def _should_persist_flow(conn: Connection) -> bool:
    """Return True if this flow should be written to the DB (deduped by 60s window)."""
    if conn.protocol in ("ARP", "ICMP", "Other"):
        return False
    key = (conn.src_ip, conn.dst_ip, conn.dst_port, conn.protocol)
    now = time.monotonic()
    with _flow_lock:
        last = _flow_seen.get(key, 0.0)
        if now - last < FLOW_DEDUP_SECONDS:
            return False
        _flow_seen[key] = now
        # Prune stale entries to prevent unbounded growth
        if len(_flow_seen) > 20_000:
            cutoff = now - FLOW_DEDUP_SECONDS * 2
            stale = [k for k, v in _flow_seen.items() if v < cutoff]
            for k in stale:
                del _flow_seen[k]
    return True


def _should_persist_dns(src_ip: str, domain: str) -> bool:
    """Return True if this (src_ip, domain) hasn't been logged in the dedup window."""
    key = (src_ip, domain)
    now = time.monotonic()
    with _dns_lock:
        last = _dns_seen.get(key, 0.0)
        if now - last < DNS_DEDUP_SECONDS:
            return False
        _dns_seen[key] = now
        if len(_dns_seen) > 10_000:
            cutoff = now - DNS_DEDUP_SECONDS * 2
            stale = [k for k, v in _dns_seen.items() if v < cutoff]
            for k in stale:
                del _dns_seen[k]
    return True


# ---------------------------------------------------------------------------
# Packet callback
# ---------------------------------------------------------------------------

def _packet_callback(pkt) -> None:
    try:
        from scapy.layers.inet import IP, TCP, UDP
        from scapy.layers.l2 import ARP

        if pkt.haslayer(ARP):
            proto = "ARP"
            src_ip = pkt[ARP].psrc
            dst_ip = pkt[ARP].pdst
            src_port = dst_port = None
            pkt_len = len(pkt)
        elif pkt.haslayer(IP):
            ip_layer = pkt[IP]
            src_ip = ip_layer.src
            dst_ip = ip_layer.dst
            proto = _classify_protocol(pkt)
            pkt_len = len(pkt)
            src_port = (
                pkt[TCP].sport if pkt.haslayer(TCP)
                else (pkt[UDP].sport if pkt.haslayer(UDP) else None)
            )
            dst_port = (
                pkt[TCP].dport if pkt.haslayer(TCP)
                else (pkt[UDP].dport if pkt.haslayer(UDP) else None)
            )
        else:
            return

        now = datetime.now(timezone.utc)
        minute_bucket = now.replace(second=0, microsecond=0)

        conn = Connection(
            ts=now, src_ip=src_ip, dst_ip=dst_ip,
            src_port=src_port, dst_port=dst_port,
            protocol=proto, bytes=pkt_len, packets=1,
        )

        with _connections_lock:
            _recent_connections.append(conn)

        with _proto_lock:
            _proto_counts[proto] = _proto_counts.get(proto, 0) + 1

        # Enqueue external IPs for geolocation
        try:
            from engines.geoip import enqueue as geo_enqueue
            geo_enqueue(src_ip)
            geo_enqueue(dst_ip)
        except Exception:
            pass

        # Accumulate traffic stats
        with _traffic_lock:
            _traffic_acc[(minute_bucket, src_ip)]["bytes_out"] += pkt_len
            _traffic_acc[(minute_bucket, src_ip)]["packets_out"] += 1
            _traffic_acc[(minute_bucket, dst_ip)]["bytes_in"] += pkt_len
            _traffic_acc[(minute_bucket, dst_ip)]["packets_in"] += 1

        # Non-blocking push to async queue
        if _event_queue is not None:
            try:
                _event_queue.put_nowait(conn)
            except asyncio.QueueFull:
                pass

        # --- Deep inspection: DNS ---
        if proto == "DNS":
            domain = _extract_dns_query(pkt)
            if domain and domain not in ("", "."):
                _handle_dns_entry(src_ip, domain, "DNS", now)

        # --- Deep inspection: TLS SNI (outbound SYN-data on port 443) ---
        elif proto == "TLS" and pkt.haslayer(TCP):
            tcp_layer = pkt[TCP]
            if tcp_layer.dport == 443 and tcp_layer.payload:
                raw = bytes(tcp_layer.payload)
                sni = _extract_tls_sni(raw)
                if sni:
                    _handle_dns_entry(src_ip, sni, "SNI", now)

        # --- Deep inspection: HTTP Host header ---
        elif proto == "HTTP" and pkt.haslayer(TCP):
            tcp_layer = pkt[TCP]
            if tcp_layer.dport == 80 and tcp_layer.payload:
                raw = bytes(tcp_layer.payload)
                result = _extract_http_host(raw)
                if result:
                    host, path = result
                    # Include search query paths in the domain string
                    label = f"{host}{path}" if (
                        len(path) > 1 and len(path) < 120
                    ) else host
                    _handle_dns_entry(src_ip, label, "HTTP", now)

        # --- Persist interesting flows to DB ---
        if _should_persist_flow(conn):
            with _conn_queue_lock:
                _conn_write_queue.append(conn)

    except Exception:
        pass  # Never crash the capture loop


def _handle_dns_entry(src_ip: str, domain: str, query_type: str, ts: datetime) -> None:
    """Record a DNS/SNI/HTTP domain observation."""
    entry = {
        "ts": ts.isoformat(),
        "src_ip": src_ip,
        "domain": domain,
        "query_type": query_type,
    }
    with _dns_recent_lock:
        _dns_recent.append(entry)

    # Alerts check
    try:
        from engines import alerts
        alerts.on_dns_query(src_ip, domain)
    except Exception:
        pass

    # Queue for DB persistence if not recently seen
    base_domain = domain.split("/")[0]  # strip HTTP paths for dedup key
    if _should_persist_dns(src_ip, base_domain):
        with _dns_queue_lock:
            _dns_write_queue.append({
                "ts": ts,
                "src_ip": src_ip,
                "domain": domain,
                "query_type": query_type,
            })


# ---------------------------------------------------------------------------
# Traffic stats + connection flush thread
# ---------------------------------------------------------------------------

def _flush_loop(stop_event: threading.Event) -> None:
    """Flush traffic stats and DB write queues periodically."""
    tick = 0
    while not stop_event.is_set():
        stop_event.wait(5)
        if stop_event.is_set():
            break
        tick += 1

        # --- Flush DNS write queue (every 5 s) ---
        with _dns_queue_lock:
            dns_batch = _dns_write_queue[:]
            _dns_write_queue.clear()
        for entry in dns_batch:
            try:
                q.insert_dns_query(entry["ts"], entry["src_ip"], entry["domain"], entry["query_type"])
            except Exception as exc:
                log.debug("DNS write error: %s", exc)

        # --- Flush connection write queue (every 5 s) ---
        with _conn_queue_lock:
            conn_batch = _conn_write_queue[:]
            _conn_write_queue.clear()
        for conn in conn_batch:
            try:
                q.insert_connection(conn)
            except Exception as exc:
                log.debug("Connection write error: %s", exc)

        # --- Poll OS DNS cache (every 30 s = 6 ticks of 5 s) ---
        if tick % 6 == 0:
            _poll_dns_cache()

        # --- Flush traffic stats (every 60 s = 12 ticks of 5 s) ---
        if tick % 12 == 0:
            with _traffic_lock:
                snapshot = dict(_traffic_acc)
                _traffic_acc.clear()

            for (ts, ip), stats in snapshot.items():
                if ip in ("", "0.0.0.0", "255.255.255.255"):
                    continue
                try:
                    q.upsert_traffic_stat(TrafficPoint(
                        ts=ts, ip=ip,
                        bytes_out=stats["bytes_out"],
                        bytes_in=stats["bytes_in"],
                        packets_out=stats["packets_out"],
                        packets_in=stats["packets_in"],
                    ))
                except Exception as exc:
                    log.debug("Traffic stat flush error: %s", exc)

                # Check for traffic spikes
                try:
                    from engines import alerts
                    alerts.on_traffic_spike(ip, stats["bytes_out"])
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Sniff loop
# ---------------------------------------------------------------------------

def _sniff_loop(iface: str, stop_event: threading.Event) -> None:
    log.info("Packet capture started on interface '%s'", iface)
    try:
        from scapy.sendrecv import sniff
        sniff(
            iface=iface,
            prn=_packet_callback,
            store=False,
            stop_filter=lambda _: stop_event.is_set(),
        )
    except Exception as exc:
        log.error("Packet capture error: %s", exc)
        log.error("Ensure Npcap is installed and the backend is running as Administrator.")
    log.info("Packet capture stopped")


# ---------------------------------------------------------------------------
# OS DNS cache polling (supplements packet-level capture for modern traffic)
# ---------------------------------------------------------------------------
_dns_cache_seen: dict[str, float] = {}  # domain → last_ingested monotonic time
_DNS_CACHE_POLL_SECONDS = 30  # how often to poll (seconds)


def _read_dns_cache_windows() -> list[str]:
    """Return domain names currently in the Windows DNS resolver cache."""
    import subprocess
    import json as _json
    try:
        flags = 0x08000000  # CREATE_NO_WINDOW — suppress console popup
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-NonInteractive", "-Command",
                "Get-DnsClientCache | Select-Object -ExpandProperty Entry | Sort-Object -Unique | ConvertTo-Json -Compress",
            ],
            capture_output=True, text=True, timeout=10, creationflags=flags,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []
        data = _json.loads(result.stdout)
        if isinstance(data, str):
            data = [data]
        return [str(d).strip().rstrip(".") for d in data if d]
    except Exception as exc:
        log.debug("DNS cache read (Windows) error: %s", exc)
        return []


def _read_dns_cache_macos() -> list[str]:
    """Return domain names from the macOS mDNSResponder cache."""
    import subprocess
    import re
    try:
        result = subprocess.run(
            ["dscacheutil", "-cachedump", "-entries", "Host"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return []
        return [m.group(1).rstrip(".") for m in re.finditer(r"name:\s+(\S+)", result.stdout)]
    except Exception as exc:
        log.debug("DNS cache read (macOS) error: %s", exc)
        return []


def _poll_dns_cache() -> None:
    """Read the OS DNS cache and inject new entries into the spy ring buffer."""
    import platform
    try:
        system = platform.system()
        if system == "Windows":
            domains = _read_dns_cache_windows()
        elif system == "Darwin":
            domains = _read_dns_cache_macos()
        else:
            return

        if not domains:
            return

        import socket as _socket
        try:
            with _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
        except Exception:
            return

        now_mono = time.monotonic()
        now_dt = datetime.now(timezone.utc)

        for domain in domains:
            if not domain or "." not in domain or len(domain) < 4:
                continue
            last = _dns_cache_seen.get(domain, 0.0)
            if now_mono - last < _DNS_CACHE_POLL_SECONDS:
                continue
            _dns_cache_seen[domain] = now_mono
            _handle_dns_entry(local_ip, domain, "DNS", now_dt)

        # Prune stale dedup entries (older than 1 hour)
        cutoff = now_mono - 3600
        stale = [k for k, v in _dns_cache_seen.items() if v < cutoff]
        for k in stale:
            del _dns_cache_seen[k]

    except Exception as exc:
        log.debug("DNS cache poll error: %s", exc)


_stop_event = threading.Event()
_sniff_thread: threading.Thread | None = None
_flush_thread: threading.Thread | None = None


def start() -> None:
    global _sniff_thread, _flush_thread
    iface = config.get_interface()
    _stop_event.clear()

    _sniff_thread = threading.Thread(
        target=_sniff_loop, args=(iface, _stop_event), daemon=True, name="capture"
    )
    _sniff_thread.start()

    _flush_thread = threading.Thread(
        target=_flush_loop, args=(_stop_event,), daemon=True, name="flush"
    )
    _flush_thread.start()


def stop() -> None:
    _stop_event.set()
