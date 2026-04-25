"""
GeoIP engine.

Resolves public IP addresses to geographic coordinates using the ip-api.com
batch API (free, no key, up to 100 IPs per request, 45 requests/min).

Architecture:
  - capture.py calls enqueue(ip) for every external IP it sees
  - A background asyncio task drains the queue every 2 seconds and fires
    a single batch HTTP request to ip-api.com
  - Results are stored in both an in-memory dict and DuckDB (for restart
    persistence)
  - Private/loopback/multicast addresses are silently ignored
"""
from __future__ import annotations
import asyncio
import ipaddress
import logging
import queue as stdlib_queue
import threading
from datetime import datetime, timezone

import httpx

log = logging.getLogger("lattice.geoip")

# ---------------------------------------------------------------------------
# Private IP ranges to skip
# ---------------------------------------------------------------------------
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local
    ipaddress.ip_network("224.0.0.0/4"),       # multicast
    ipaddress.ip_network("240.0.0.0/4"),       # reserved
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),     # CGNAT
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_private_ip(ip: str) -> bool:
    """Return True if the IP is private, loopback, multicast, or reserved."""
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        return True  # malformed → treat as private


# ---------------------------------------------------------------------------
# In-memory geo cache
# ---------------------------------------------------------------------------

GeoRecord = dict  # {"lat", "lon", "city", "country", "country_code", "isp", "org", "as"}

_cache: dict[str, GeoRecord] = {}

# IPs waiting to be resolved.
# Must be a stdlib queue (thread-safe) because enqueue() is called from Scapy's
# sync capture thread while _resolver_loop() runs on the asyncio event loop.
# asyncio.Queue is NOT thread-safe and silently drops put_nowait() calls from
# non-async threads, which would leave the geo cache permanently empty.
_pending_queue: stdlib_queue.SimpleQueue[str] = stdlib_queue.SimpleQueue()

# IPs already in cache or pending — avoid duplicate enqueues.
# Uses a threading.Lock because enqueue() is called from sync capture threads.
_seen: set[str] = set()
_seen_lock = threading.Lock()

# Own public IP location (arc origin)
_my_location: GeoRecord | None = None


def enqueue(ip: str) -> None:
    """Non-blocking — safe to call from sync threads in capture.py.

    SimpleQueue.put() is always non-blocking (unbounded queue) and is
    guaranteed thread-safe, unlike asyncio.Queue.
    """
    if is_private_ip(ip):
        return
    with _seen_lock:
        if ip in _seen:
            return
        _seen.add(ip)
    _pending_queue.put(ip)


def get_geo(ip: str) -> GeoRecord | None:
    return _cache.get(ip)


def get_all_cached() -> dict[str, GeoRecord]:
    return dict(_cache)


def get_my_location() -> GeoRecord | None:
    return _my_location


# ---------------------------------------------------------------------------
# Background resolver
# ---------------------------------------------------------------------------

IP_API_BATCH_URL = "http://ip-api.com/batch"
IP_API_FIELDS = "status,message,country,countryCode,city,lat,lon,isp,org,as,query"
BATCH_SIZE = 100
RESOLVE_INTERVAL = 2.5  # seconds between batch calls


async def _resolve_batch(ips: list[str]) -> list[GeoRecord]:
    """Call ip-api.com batch endpoint and return list of results."""
    payload = [
        {"query": ip, "fields": IP_API_FIELDS}
        for ip in ips
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(IP_API_BATCH_URL, json=payload)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        log.warning("ip-api.com batch error: %s", exc)
        return []


async def _resolver_loop() -> None:
    """Background task: drains queue and resolves IPs in batches."""
    # Load persisted cache from DuckDB on startup
    try:
        import db.queries as q
        for record in q.get_all_geo():
            _cache[record["ip"]] = record
            _seen.add(record["ip"])
        log.info("GeoIP: loaded %d cached locations from DB", len(_cache))
    except Exception as exc:
        log.debug("GeoIP cache load error: %s", exc)

    # Detect own location
    await _detect_my_location()

    while True:
        await asyncio.sleep(RESOLVE_INTERVAL)

        # Drain up to BATCH_SIZE IPs from the thread-safe stdlib queue
        batch: list[str] = []
        while len(batch) < BATCH_SIZE:
            try:
                ip = _pending_queue.get_nowait()
                if ip not in _cache:  # skip already-resolved
                    batch.append(ip)
            except stdlib_queue.Empty:
                break

        if not batch:
            continue

        log.debug("GeoIP: resolving batch of %d IPs", len(batch))
        results = await _resolve_batch(batch)

        import db.queries as q
        for record in results:
            if record.get("status") != "success":
                continue
            ip = record.get("query", "")
            if not ip:
                continue

            geo: GeoRecord = {
                "ip": ip,
                "lat": record.get("lat", 0.0),
                "lon": record.get("lon", 0.0),
                "city": record.get("city", ""),
                "country": record.get("country", ""),
                "country_code": record.get("countryCode", ""),
                "isp": record.get("isp", ""),
                "org": record.get("org", ""),
                "as_name": record.get("as", ""),
            }

            _cache[ip] = geo
            try:
                q.upsert_geo(geo)
            except Exception as exc:
                log.debug("GeoIP DB write error: %s", exc)

        log.debug("GeoIP: resolved %d/%d IPs", len(results), len(batch))


async def _detect_my_location() -> None:
    """Detect the machine's own public IP and location."""
    global _my_location
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get("https://ipinfo.io/json")
            data = resp.json()
            loc = data.get("loc", "0,0").split(",")
            _my_location = {
                "ip": data.get("ip", ""),
                "lat": float(loc[0]),
                "lon": float(loc[1]),
                "city": data.get("city", ""),
                "country": data.get("country", ""),
                "country_code": data.get("country", ""),
                "isp": data.get("org", ""),
                "org": data.get("org", ""),
                "as_name": data.get("org", ""),
            }
            log.info(
                "GeoIP: my location → %s, %s (%.4f, %.4f)",
                _my_location["city"], _my_location["country"],
                _my_location["lat"], _my_location["lon"],
            )
    except Exception as exc:
        log.warning("GeoIP: could not detect own location: %s", exc)
        # Fallback to a neutral default
        _my_location = {
            "ip": "", "lat": 37.751, "lon": -97.822,
            "city": "United States", "country": "US",
            "country_code": "US", "isp": "", "org": "", "as_name": "",
        }


def start() -> asyncio.Task:
    """Start the background resolver. Returns the asyncio Task.
    Must be called from within a running asyncio context (e.g. FastAPI lifespan).
    """
    task = asyncio.get_running_loop().create_task(_resolver_loop())
    log.info("GeoIP resolver started")
    return task
