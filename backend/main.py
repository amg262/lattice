"""
Lattice — Local Network Intelligence Dashboard
FastAPI application entry point.

Run as Administrator:
    python main.py
Or with auto-reload for development:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
from __future__ import annotations
import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
import db.database as database
import db.queries as queries
import engines.capture as capture
import engines.geoip as geoip
import engines.scanner as scanner
from api import devices, dns, events, geo, traffic, websocket

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("lattice")


# ---------------------------------------------------------------------------
# Lifespan: start/stop background engines
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=" * 60)
    log.info("  Lattice Network Dashboard starting")
    log.info("  Interface : %s", config.get_interface())
    log.info("  Subnet    : %s", config.get_subnet())
    log.info("  DB        : %s", config.DB_PATH)
    log.info("=" * 60)

    # Initialise DB schema
    database.get_conn()

    # Create asyncio queue for live packet events
    event_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
    capture.set_event_queue(event_queue)

    # Start background threads
    scanner.start()
    capture.start()

    # Start async tasks
    geo_task = geoip.start()
    broadcast_task = asyncio.create_task(websocket.broadcast_loop())
    purge_task = asyncio.create_task(_daily_purge())

    yield  # Application runs

    # Shutdown
    log.info("Shutting down engines...")
    broadcast_task.cancel()
    geo_task.cancel()
    purge_task.cancel()
    scanner.stop()
    capture.stop()
    log.info("Shutdown complete.")


async def _daily_purge() -> None:
    """Run purge_old_data once every 24 hours."""
    while True:
        await asyncio.sleep(86_400)
        try:
            queries.purge_old_data(config.RETENTION_DAYS)
            log.info("Purged data older than %d days", config.RETENTION_DAYS)
        except Exception as exc:
            log.warning("Data purge failed: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Lattice Network Dashboard",
    description="Local network intelligence and monitoring dashboard",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router)
app.include_router(traffic.router)
app.include_router(geo.router)
app.include_router(dns.router)
app.include_router(events.router)
app.include_router(websocket.router)


@app.get("/api/status")
def status():
    """Health check + current config."""
    return {
        "status": "ok",
        "interface": config.get_interface(),
        "subnet": config.get_subnet(),
        "arp_sweep_interval": config.ARP_SWEEP_INTERVAL,
        "nmap_scan_interval": config.NMAP_SCAN_INTERVAL,
    }


# ---------------------------------------------------------------------------
# Dev server entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False,
    )
