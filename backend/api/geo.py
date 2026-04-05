"""REST endpoints for geolocation data."""
from __future__ import annotations
from fastapi import APIRouter, Query
import engines.capture as capture
import engines.geoip as geoip

router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/flows")
def geo_flows(limit: int = Query(60, ge=1, le=200)):
    """
    Return recent external connections enriched with geolocation.
    Only connections where the dst_ip has a known geo record are returned.
    """
    recent = capture.get_recent_connections(limit=500)
    results = []

    for conn in recent:
        # Determine which side is the external IP
        src_priv = geoip.is_private_ip(conn.src_ip)
        dst_priv = geoip.is_private_ip(conn.dst_ip)

        remote_ip = None
        if not dst_priv:
            remote_ip = conn.dst_ip
        elif not src_priv:
            remote_ip = conn.src_ip

        if not remote_ip:
            continue

        geo = geoip.get_geo(remote_ip)
        if not geo:
            # Not resolved yet — still enqueue it
            geoip.enqueue(remote_ip)
            continue

        results.append({
            "ts": conn.ts.isoformat() if hasattr(conn.ts, "isoformat") else str(conn.ts),
            "src_ip": conn.src_ip,
            "dst_ip": conn.dst_ip,
            "src_port": conn.src_port,
            "dst_port": conn.dst_port,
            "protocol": conn.protocol,
            "bytes": conn.bytes,
            "packets": conn.packets,
            "remote_ip": remote_ip,
            "lat": geo["lat"],
            "lon": geo["lon"],
            "city": geo["city"],
            "country": geo["country"],
            "country_code": geo["country_code"],
            "isp": geo["isp"],
            "org": geo["org"],
            "as_name": geo["as_name"],
        })

        if len(results) >= limit:
            break

    return results


@router.get("/locations")
def geo_locations():
    """
    Return all cached IP→location mappings.
    Used to pre-populate the scatter dot layer on first map load.
    """
    return list(geoip.get_all_cached().values())


@router.get("/myip")
def my_ip():
    """Return the detected own public IP location (arc origin point)."""
    loc = geoip.get_my_location()
    if loc is None:
        return {"status": "detecting"}
    return {"status": "ok", **loc}
