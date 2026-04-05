"""
Packet capture engine.

Uses scapy on top of Npcap (Windows) to sniff all traffic on the selected
interface. Parsed connection events are pushed into an asyncio.Queue so the
WebSocket broadcaster can relay them to the frontend in real-time.

Traffic stats (bytes per IP per minute) are also accumulated and flushed to
DuckDB periodically.
"""
from __future__ import annotations
import asyncio
import collections
import logging
import math
import threading
from datetime import datetime, timezone

import config
import db.queries as q
from models.schemas import Connection, TrafficPoint

log = logging.getLogger("lattice.capture")

# The asyncio queue that the WS broadcaster reads from
_event_queue: asyncio.Queue | None = None

# In-memory ring buffer for recent connections (used in WS snapshots)
_recent_connections: collections.deque[Connection] = collections.deque(
    maxlen=config.MAX_CONNECTIONS_HISTORY
)
_connections_lock = threading.Lock()

# Per-IP traffic accumulators keyed by (minute_bucket, ip)
_traffic_acc: dict[tuple, dict] = collections.defaultdict(
    lambda: {"bytes_out": 0, "bytes_in": 0, "packets_out": 0, "packets_in": 0}
)
_traffic_lock = threading.Lock()

# Protocol counter (last 60 min, reset periodically)
_proto_counts: dict[str, int] = collections.defaultdict(int)
_proto_lock = threading.Lock()


def set_event_queue(queue: asyncio.Queue) -> None:
    global _event_queue
    _event_queue = queue


def get_recent_connections(limit: int = 50) -> list[Connection]:
    with _connections_lock:
        items = list(_recent_connections)
    return list(reversed(items))[:limit]


def get_protocol_counts() -> dict[str, int]:
    with _proto_lock:
        return dict(_proto_counts)


def reset_protocol_counts() -> None:
    with _proto_lock:
        _proto_counts.clear()


# ---------------------------------------------------------------------------
# Packet callback
# ---------------------------------------------------------------------------

def _classify_protocol(pkt) -> str:
    """Return a human-readable protocol name for a scapy packet."""
    from scapy.layers.inet import TCP, UDP, ICMP, IP
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


def _packet_callback(pkt) -> None:
    """Called by scapy for each captured packet."""
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
            src_port = pkt[TCP].sport if pkt.haslayer(TCP) else (pkt[UDP].sport if pkt.haslayer(UDP) else None)
            dst_port = pkt[TCP].dport if pkt.haslayer(TCP) else (pkt[UDP].dport if pkt.haslayer(UDP) else None)
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

        # Accumulate traffic stats
        with _traffic_lock:
            _traffic_acc[(minute_bucket, src_ip)]["bytes_out"] += pkt_len
            _traffic_acc[(minute_bucket, src_ip)]["packets_out"] += 1
            _traffic_acc[(minute_bucket, dst_ip)]["bytes_in"] += pkt_len
            _traffic_acc[(minute_bucket, dst_ip)]["packets_in"] += 1

        # Non-blocking push to async queue (drop if full)
        if _event_queue is not None:
            try:
                _event_queue.put_nowait(conn)
            except asyncio.QueueFull:
                pass

    except Exception:
        pass  # Never crash the capture loop on a bad packet


# ---------------------------------------------------------------------------
# Traffic stats flush (runs in its own thread)
# ---------------------------------------------------------------------------

def _flush_traffic_stats(stop_event: threading.Event) -> None:
    """Periodically flush accumulated traffic stats to DuckDB."""
    while not stop_event.is_set():
        stop_event.wait(60)
        if stop_event.is_set():
            break

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
        target=_flush_traffic_stats, args=(_stop_event,), daemon=True, name="flush"
    )
    _flush_thread.start()


def stop() -> None:
    _stop_event.set()
