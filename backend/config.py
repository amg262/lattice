"""
Lattice configuration — edit these values to customize behaviour.
All settings can be overridden via environment variables with the
same name (uppercased), e.g. INTERFACE=eth0 python main.py.
"""
import os
import socket
import psutil

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

# Network interface to capture packets on and use for ARP sweeps.
# Set to None to auto-detect the primary interface.
# Example: "Wi-Fi", "Ethernet", "eth0"
INTERFACE: str | None = os.environ.get("INTERFACE", None)

# Subnet to scan in CIDR notation.
# Set to None to auto-detect from the selected interface.
# Example: "192.168.1.0/24"
SUBNET: str | None = os.environ.get("SUBNET", None)

# ---------------------------------------------------------------------------
# Scan intervals (seconds)
# ---------------------------------------------------------------------------

# How often to run an ARP sweep to discover/confirm live hosts
ARP_SWEEP_INTERVAL: int = int(os.environ.get("ARP_SWEEP_INTERVAL", 30))

# How often to run a full nmap port + OS scan on known devices
NMAP_SCAN_INTERVAL: int = int(os.environ.get("NMAP_SCAN_INTERVAL", 300))

# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

# How often (seconds) to push a snapshot to connected WebSocket clients
WS_PUSH_INTERVAL: float = float(os.environ.get("WS_PUSH_INTERVAL", 2))

# How many recent connection events to keep in the in-memory ring buffer
MAX_CONNECTIONS_HISTORY: int = int(os.environ.get("MAX_CONNECTIONS_HISTORY", 500))

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get("DB_PATH", "lattice.duckdb")

# How many days of connection history to retain in the DB
RETENTION_DAYS: int = int(os.environ.get("RETENTION_DAYS", 7))

# ---------------------------------------------------------------------------
# Auto-detection helpers
# ---------------------------------------------------------------------------

def detect_primary_interface() -> str:
    """Return the name of the interface that has the default route."""
    try:
        # Connect a UDP socket to a public address — no data is actually sent
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]

        for iface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and addr.address == local_ip:
                    return iface
    except Exception:
        pass

    # Fallback: first non-loopback interface with an IPv4 address
    for iface, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                return iface

    raise RuntimeError("Could not detect a primary network interface. Set INTERFACE in config.py.")


def detect_subnet(iface: str) -> str:
    """Derive the /24 subnet from the interface's IPv4 address."""
    for addrs in psutil.net_if_addrs().get(iface, []):
        if addrs.family == socket.AF_INET and not addrs.address.startswith("127."):
            parts = addrs.address.split(".")
            return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    raise RuntimeError(f"No IPv4 address found on interface '{iface}'. Set SUBNET in config.py.")


def get_interface() -> str:
    return INTERFACE or detect_primary_interface()


def get_subnet() -> str:
    if SUBNET:
        return SUBNET
    return detect_subnet(get_interface())
