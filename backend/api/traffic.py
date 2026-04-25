"""REST endpoints for traffic and analytics data."""
from __future__ import annotations
from fastapi import APIRouter, Query
import db.queries as q
import engines.capture as capture

router = APIRouter(prefix="/api/traffic", tags=["traffic"])


@router.get("/history")
def traffic_history(
    ip: str | None = Query(None, description="Filter by IP (omit for aggregate)"),
    hours: int = Query(1, ge=1, le=72, description="How many hours of history to return"),
):
    """Return bandwidth history bucketed by minute."""
    return q.get_traffic_history(ip=ip, hours=hours)


@router.get("/talkers")
def top_talkers(
    limit: int = Query(10, ge=1, le=50),
    minutes: int = Query(10, ge=1, le=1440),
):
    """Return top talkers by outbound bytes."""
    return q.get_top_talkers(limit=limit, minutes=minutes)


@router.get("/protocols")
def protocol_distribution():
    """Return live protocol counts from the capture engine's in-memory counter."""
    counts = capture.get_protocol_counts()
    total = sum(counts.values()) or 1
    return [
        {"protocol": proto, "count": cnt, "pct": round(cnt / total * 100, 1)}
        for proto, cnt in sorted(counts.items(), key=lambda x: -x[1])
    ]


@router.get("/connections")
def recent_connections(limit: int = Query(50, ge=1, le=200)):
    """Return recent connection events."""
    conns = capture.get_recent_connections(limit=limit)
    return [c.model_dump() for c in conns]


@router.get("/stats")
def overall_stats():
    """Return high-level stats for the header status bar."""
    devices = q.get_all_devices()
    alive_count = sum(1 for d in devices if d.is_alive)
    conns = capture.get_recent_connections(limit=1000)
    total_bytes = sum(c.bytes for c in conns)
    proto_counts = capture.get_protocol_counts()

    return {
        "total_devices": len(devices),
        "alive_devices": alive_count,
        "total_connections_captured": len(conns),
        "total_bytes_captured": total_bytes,
        "top_protocol": max(proto_counts, key=proto_counts.get) if proto_counts else "—",
    }


@router.get("/usage")
def traffic_usage(
    ip: str | None = Query(None, description="Device IP (omit for all devices)"),
    period: str = Query("day", description="Aggregation period: day | week | month"),
):
    """Return traffic usage aggregated by period.
    With ip: returns daily breakdown for that device.
    Without ip: returns per-device totals for the period.
    """
    if period not in ("day", "week", "month"):
        period = "day"
    return q.get_traffic_usage(ip=ip, period=period)
