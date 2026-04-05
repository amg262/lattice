"""REST endpoints for device data."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
import db.queries as q
import engines.scanner as scanner
import engines.enrichment as enrichment
from models.schemas import Device

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("", response_model=list[Device])
def list_devices():
    """Return all known devices, enriched with live traffic stats."""
    devices = q.get_all_devices()

    # Overlay in-memory device state (has latest is_alive, open_ports etc.)
    live = scanner.get_devices()
    result = []
    for dev in devices:
        if dev.ip in live:
            live_dev = live[dev.ip]
            # Merge: prefer live open_ports/os_guess/is_alive
            dev = dev.model_copy(update={
                "is_alive": live_dev.is_alive,
                "open_ports": live_dev.open_ports or dev.open_ports,
                "os_guess": live_dev.os_guess or dev.os_guess,
            })
        result.append(dev)

    return result


@router.get("/{ip}", response_model=Device)
def get_device(ip: str):
    """Return details for a single device."""
    dev = q.get_device(ip)
    if not dev:
        raise HTTPException(status_code=404, detail=f"Device {ip} not found")

    live = scanner.get_devices()
    if ip in live:
        live_dev = live[ip]
        dev = dev.model_copy(update={
            "is_alive": live_dev.is_alive,
            "open_ports": live_dev.open_ports or dev.open_ports,
            "os_guess": live_dev.os_guess or dev.os_guess,
        })

    return dev


@router.post("/{ip}/rescan")
def rescan_device(ip: str):
    """Trigger an immediate nmap rescan of a device (async, returns immediately)."""
    import threading
    import db.queries as q2

    def _do_scan():
        from engines.scanner import _nmap_scan_device
        open_ports, os_guess = _nmap_scan_device(ip)
        dev = q2.get_device(ip)
        if dev:
            updated = dev.model_copy(update={
                "open_ports": open_ports or dev.open_ports,
                "os_guess": os_guess or dev.os_guess,
            })
            q2.upsert_device(updated)

    threading.Thread(target=_do_scan, daemon=True).start()
    return {"status": "scan_started", "ip": ip}
