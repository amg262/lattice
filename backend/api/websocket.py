"""
WebSocket broadcaster.

Maintains a set of connected clients and pushes a snapshot every
WS_PUSH_INTERVAL seconds containing:
  - Full device list (from scanner in-memory state)
  - Last N connections (from capture ring buffer)
  - Top talkers (last 10 minutes)
  - Protocol distribution
  - High-level stats
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
import db.queries as q
import engines.capture as capture
import engines.geoip as geoip
import engines.scanner as scanner

log = logging.getLogger("lattice.ws")
router = APIRouter(tags=["websocket"])

# Set of active WebSocket connections
_clients: set[WebSocket] = set()
_clients_lock = asyncio.Lock()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    async with _clients_lock:
        _clients.add(ws)
    log.info("WebSocket client connected (%d total)", len(_clients))

    try:
        # Send an immediate snapshot on connect so the UI isn't blank
        payload = _build_snapshot()
        await ws.send_text(json.dumps(payload, default=str))

        # Keep the connection alive — the broadcast loop handles further sends
        while True:
            # We just need to keep this coroutine alive and detect disconnects
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Ping to keep alive
                await ws.send_text(json.dumps({"type": "ping"}))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("WebSocket error: %s", exc)
    finally:
        async with _clients_lock:
            _clients.discard(ws)
        log.info("WebSocket client disconnected (%d remaining)", len(_clients))


async def broadcast_loop():
    """Background coroutine that pushes snapshots to all clients periodically."""
    log.info("WebSocket broadcast loop started (interval=%.1fs)", config.WS_PUSH_INTERVAL)
    while True:
        await asyncio.sleep(config.WS_PUSH_INTERVAL)
        async with _clients_lock:
            if not _clients:
                continue
            clients_copy = set(_clients)

        payload_str = json.dumps(_build_snapshot(), default=str)
        dead = set()

        for client in clients_copy:
            try:
                await client.send_text(payload_str)
            except Exception:
                dead.add(client)

        if dead:
            async with _clients_lock:
                _clients -= dead


def _build_snapshot() -> dict:
    """Build the full JSON payload for a WebSocket push."""
    devices = scanner.get_devices()
    recent_conns = capture.get_recent_connections(limit=40)
    proto_counts = capture.get_protocol_counts()
    top_talkers = q.get_top_talkers(limit=8, minutes=5)

    total = sum(proto_counts.values()) or 1
    protocol_distribution = [
        {"protocol": proto, "count": cnt, "pct": round(cnt / total * 100, 1)}
        for proto, cnt in sorted(proto_counts.items(), key=lambda x: -x[1])
    ]

    alive_count = sum(1 for d in devices.values() if d.is_alive)

    # Build geo_flows: recent external connections with geo resolved
    geo_flows = []
    for conn in recent_conns:
        src_priv = geoip.is_private_ip(conn.src_ip)
        dst_priv = geoip.is_private_ip(conn.dst_ip)
        remote_ip = conn.dst_ip if not dst_priv else (conn.src_ip if not src_priv else None)
        if not remote_ip:
            continue
        geo = geoip.get_geo(remote_ip)
        if not geo:
            continue
        geo_flows.append({
            "ts": conn.ts.isoformat() if hasattr(conn.ts, "isoformat") else str(conn.ts),
            "src_ip": conn.src_ip,
            "dst_ip": conn.dst_ip,
            "src_port": conn.src_port,
            "dst_port": conn.dst_port,
            "protocol": conn.protocol,
            "bytes": conn.bytes,
            "remote_ip": remote_ip,
            **{k: geo[k] for k in ("lat", "lon", "city", "country", "country_code", "isp", "org")},
        })
        if len(geo_flows) >= 30:
            break

    my_loc = geoip.get_my_location()

    return {
        "type": "snapshot",
        "ts": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "total_devices": len(devices),
            "alive_devices": alive_count,
            "top_protocol": max(proto_counts, key=proto_counts.get) if proto_counts else "—",
        },
        "devices": [d.model_dump() for d in devices.values()],
        "connections": [c.model_dump() for c in recent_conns],
        "top_talkers": top_talkers,
        "protocol_distribution": protocol_distribution,
        "geo_flows": geo_flows,
        "my_location": my_loc,
    }
