"""
Network scanner engine.

Performs two kinds of scans:
  1. ARP sweep  — fast LAN host discovery every ARP_SWEEP_INTERVAL seconds
  2. Nmap scan  — slower port + OS fingerprinting every NMAP_SCAN_INTERVAL seconds

Results are written directly to the DuckDB devices table via db/queries.py.
"""
from __future__ import annotations
import logging
import threading
import time
from datetime import datetime, timezone

import config
import db.queries as q
from models.schemas import Device

log = logging.getLogger("lattice.scanner")

# Shared state: ip → Device, kept in-memory for fast WebSocket reads
_devices: dict[str, Device] = {}
_devices_lock = threading.Lock()


def get_devices() -> dict[str, Device]:
    with _devices_lock:
        return dict(_devices)


# ---------------------------------------------------------------------------
# ARP sweep
# ---------------------------------------------------------------------------

def _arp_sweep(subnet: str, iface: str) -> list[tuple[str, str]]:
    """Return list of (ip, mac) tuples found alive on the subnet."""
    try:
        from scapy.layers.l2 import ARP, Ether
        from scapy.sendrecv import srp

        pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=subnet)
        answered, _ = srp(pkt, iface=iface, timeout=3, verbose=False)
        return [(rcv.psrc, rcv.hwsrc) for _, rcv in answered]
    except Exception as exc:
        log.warning("ARP sweep failed (%s) — falling back to ping scan", exc)
        return _ping_fallback(subnet)


def _ping_fallback(subnet: str) -> list[tuple[str, str]]:
    """ICMP/TCP ping sweep that works without raw-socket privileges."""
    import ipaddress, subprocess, platform, socket

    alive = []
    net = ipaddress.ip_network(subnet, strict=False)
    flag = "-n" if platform.system() == "Windows" else "-c"

    for host in list(net.hosts())[:254]:
        ip = str(host)
        result = subprocess.run(
            ["ping", flag, "1", "-w", "300", ip],
            capture_output=True, timeout=2,
        )
        if result.returncode == 0:
            # Best-effort MAC: read from ARP cache
            arp_result = subprocess.run(["arp", "-a", ip], capture_output=True, text=True)
            mac = "00:00:00:00:00:00"
            for line in arp_result.stdout.splitlines():
                if ip in line:
                    parts = line.split()
                    for part in parts:
                        if "-" in part and len(part) == 17:
                            mac = part.replace("-", ":").lower()
                            break
            alive.append((ip, mac))

    return alive


# ---------------------------------------------------------------------------
# Nmap port + OS scan
# ---------------------------------------------------------------------------

def _nmap_scan_device(ip: str) -> tuple[list[int], str]:
    """Return (open_ports, os_guess) for a single IP via nmap."""
    try:
        from libnmap.process import NmapProcess
        from libnmap.parser import NmapParser

        nm = NmapProcess(targets=ip, options="-sV -O --host-timeout 30s -T4")
        nm.run()

        if nm.rc != 0:
            log.debug("nmap non-zero for %s: %s", ip, nm.stderr)
            return [], ""

        report = NmapParser.parse(nm.stdout)
        if not report.hosts:
            return [], ""

        host = report.hosts[0]
        open_ports = [svc.port for svc in host.services if svc.state == "open"]

        os_guess = ""
        if host.os_fingerprinted and host.os.osmatches:
            os_guess = host.os.osmatches[0].name

        return open_ports, os_guess

    except ImportError:
        log.warning("python-libnmap not installed — skipping nmap scan")
        return [], ""
    except Exception as exc:
        log.warning("nmap scan error for %s: %s", ip, exc)
        return [], ""


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

def _scanner_loop(stop_event: threading.Event) -> None:
    iface = config.get_interface()
    subnet = config.get_subnet()
    log.info("Scanner started | interface=%s subnet=%s", iface, subnet)

    last_nmap_scan: dict[str, float] = {}

    while not stop_event.is_set():
        now = datetime.now(timezone.utc)

        # --- ARP sweep ---
        found = _arp_sweep(subnet, iface)
        found_ips = {ip for ip, _ in found}

        for ip, mac in found:
            with _devices_lock:
                existing = _devices.get(ip)

            if existing is None:
                from engines.enrichment import resolve_hostname, lookup_vendor
                vendor = lookup_vendor(mac)
                hostname = resolve_hostname(ip)
                dev = Device(
                    ip=ip, mac=mac, vendor=vendor, hostname=hostname,
                    first_seen=now, last_seen=now, is_alive=True,
                )
                log.info("New device discovered: %s (%s) [%s]", ip, mac, vendor)
            else:
                dev = existing.model_copy(update={"last_seen": now, "is_alive": True, "mac": mac})

            with _devices_lock:
                _devices[ip] = dev

            q.upsert_device(dev)

        # Mark devices not seen in this sweep as potentially offline
        with _devices_lock:
            all_known = list(_devices.keys())

        for ip in all_known:
            if ip not in found_ips:
                with _devices_lock:
                    dev = _devices.get(ip)
                if dev and dev.is_alive:
                    updated = dev.model_copy(update={"is_alive": False})
                    with _devices_lock:
                        _devices[ip] = updated
                    q.mark_device_dead(ip)

        # --- Nmap scan for devices that haven't been scanned recently ---
        for ip in list(found_ips):
            age = time.time() - last_nmap_scan.get(ip, 0)
            if age >= config.NMAP_SCAN_INTERVAL:
                log.debug("Running nmap scan on %s", ip)
                open_ports, os_guess = _nmap_scan_device(ip)
                last_nmap_scan[ip] = time.time()

                with _devices_lock:
                    dev = _devices.get(ip)
                if dev:
                    updated = dev.model_copy(update={
                        "open_ports": open_ports or dev.open_ports,
                        "os_guess": os_guess or dev.os_guess,
                    })
                    with _devices_lock:
                        _devices[ip] = updated
                    q.upsert_device(updated)

        stop_event.wait(config.ARP_SWEEP_INTERVAL)

    log.info("Scanner stopped")


_stop_event = threading.Event()
_thread: threading.Thread | None = None


def start() -> None:
    global _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_scanner_loop, args=(_stop_event,), daemon=True, name="scanner")
    _thread.start()


def stop() -> None:
    _stop_event.set()
