"""
Alert engine.

Detects notable network events and persists them to DuckDB.
Other engines call the on_* functions from their threads; this module
is intentionally simple and import-safe (no circular deps).
"""
from __future__ import annotations
import logging
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger("lattice.alerts")

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_known_devices: set[str] = set()
_devices_lock = threading.Lock()

_recent_events: list[dict] = []
_events_lock = threading.Lock()
MAX_RECENT_EVENTS = 100

# Throttle map: alert_key → last_fired_monotonic to suppress duplicates
_throttle: dict[str, float] = {}
_throttle_lock = threading.Lock()
THROTTLE_SECONDS = 300  # 5 minutes between repeated identical alerts

# ---------------------------------------------------------------------------
# Suspicious domain blocklist (home-network focused)
# ---------------------------------------------------------------------------

SUSPICIOUS_DOMAINS: set[str] = {
    # Known malware / C&C patterns
    "dyndns.org", "no-ip.com", "changeip.com", "afraid.org",
    # Crypto-mining pools
    "pool.minergate.com", "xmrpool.eu", "moneropool.com",
    "supportxmr.com", "nanopool.org", "mining.pool.com",
    # Common stalkerware / surveillance
    "hoverwatch.com", "mspy.com", "flexispy.com",
    # Known ad-fraud / click-fraud botnets
    "trafficjunky.net", "adnxs.com",
}

# Bytes-per-minute threshold to trigger a traffic spike alert
TRAFFIC_SPIKE_BYTES = 15 * 1024 * 1024  # 15 MB/min


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_throttled(key: str) -> bool:
    now = time.monotonic()
    with _throttle_lock:
        last = _throttle.get(key, 0.0)
        if now - last < THROTTLE_SECONDS:
            return True
        _throttle[key] = now
        return False


def _record(severity: str, device_ip: str, event_type: str, message: str) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    # Persist to DB (best-effort)
    try:
        import db.queries as q
        q.insert_event(now, severity, device_ip, event_type, message)
    except Exception as exc:
        log.debug("alert DB write failed: %s", exc)

    evt = {
        "ts": now.isoformat(),
        "severity": severity,
        "device_ip": device_ip,
        "event_type": event_type,
        "message": message,
    }
    with _events_lock:
        _recent_events.insert(0, evt)
        del _recent_events[MAX_RECENT_EVENTS:]

    log.info("ALERT [%s] %s — %s", severity.upper(), device_ip or "network", message)


# ---------------------------------------------------------------------------
# Public API — called from other engines
# ---------------------------------------------------------------------------

def get_recent_events(limit: int = 20) -> list[dict]:
    with _events_lock:
        return list(_recent_events)[:limit]


def get_unread_count(since_ts: str | None = None) -> int:
    """Return count of events newer than since_ts (ISO string)."""
    with _events_lock:
        if not since_ts:
            return len(_recent_events)
        try:
            cutoff = datetime.fromisoformat(since_ts)
            return sum(
                1 for e in _recent_events
                if datetime.fromisoformat(e["ts"].replace("Z", "+00:00")) > cutoff
            )
        except Exception:
            return 0


def seed_known_devices(ips: list[str]) -> None:
    """Pre-populate known device IPs from DB so we don't alert on restart."""
    with _devices_lock:
        _known_devices.update(ips)


# ---------------------------------------------------------------------------
# Event triggers
# ---------------------------------------------------------------------------

def on_new_device(ip: str, mac: str, vendor: str, hostname: str) -> None:
    with _devices_lock:
        if ip in _known_devices:
            return
        _known_devices.add(ip)

    if _is_throttled(f"new_device_{ip}"):
        return

    name = hostname or vendor or ip
    _record("warning", ip, "new_device", f"New device joined network: {name} [{mac}]")


def on_device_online(ip: str, vendor: str, hostname: str) -> None:
    if _is_throttled(f"device_online_{ip}"):
        return
    name = hostname or vendor or ip
    _record("info", ip, "device_online", f"{name} came back online")


def on_dns_query(src_ip: str, domain: str) -> None:
    """Check if a queried domain is on the suspicious list."""
    d = domain.lower().rstrip(".")
    # Check exact match or subdomain match
    is_bad = any(d == bad or d.endswith("." + bad) for bad in SUSPICIOUS_DOMAINS)
    if not is_bad:
        return
    if _is_throttled(f"suspicious_{src_ip}_{d}"):
        return
    _record("danger", src_ip, "suspicious_domain", f"Suspicious domain queried: {d}")


def on_traffic_spike(ip: str, bytes_per_min: int) -> None:
    if bytes_per_min < TRAFFIC_SPIKE_BYTES:
        return
    if _is_throttled(f"spike_{ip}"):
        return
    mb = bytes_per_min / 1_048_576
    _record("warning", ip, "traffic_spike", f"Traffic spike: {mb:.1f} MB in 1 minute from {ip}")
