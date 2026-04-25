"""REST endpoints for the network events / alerts log."""
from __future__ import annotations
from fastapi import APIRouter, Query
import db.queries as q
import engines.alerts as alerts

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
def list_events(
    hours: int = Query(24, ge=1, le=168),
    severity: str | None = Query(None, description="Filter: info | warning | danger"),
    limit: int = Query(100, ge=1, le=500),
):
    """Return historical events from DuckDB."""
    return q.get_events(hours=hours, severity=severity, limit=limit)


@router.get("/live")
def live_events(limit: int = Query(20, ge=1, le=100)):
    """Return the most recent events from the in-memory buffer."""
    return alerts.get_recent_events(limit=limit)
