"""REST endpoints for the DNS/SNI/HTTP spy log."""
from __future__ import annotations
from fastapi import APIRouter, Query
import db.queries as q
import engines.capture as capture

router = APIRouter(prefix="/api/dns", tags=["dns"])


@router.get("/log")
def dns_log(
    ip: str | None = Query(None, description="Filter by source IP"),
    hours: int = Query(1, ge=1, le=168, description="Hours of history"),
    limit: int = Query(200, ge=1, le=1000),
):
    """Return historical DNS/SNI/HTTP queries from DuckDB."""
    return q.get_dns_log(ip=ip, hours=hours, limit=limit)


@router.get("/top")
def top_domains(
    ip: str | None = Query(None, description="Filter by source IP"),
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(20, ge=1, le=100),
):
    """Return top queried domains (with counts) for the given window."""
    return q.get_top_domains(ip=ip, hours=hours, limit=limit)


@router.get("/live")
def live_dns(limit: int = Query(50, ge=1, le=200)):
    """Return recent DNS/SNI/HTTP entries from the in-memory ring buffer."""
    return capture.get_recent_dns(limit=limit)


@router.get("/counts")
def dns_counts_by_device(hours: int = Query(1, ge=1, le=24)):
    """Return per-device DNS query counts for badge display."""
    return q.get_dns_counts_by_device(hours=hours)
