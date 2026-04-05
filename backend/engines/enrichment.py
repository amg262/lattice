"""
Enrichment engine.

Provides:
  - MAC vendor lookup via embedded OUI prefix table (no network call needed)
  - Reverse DNS hostname resolution
  - Device type guessing based on vendor + open ports
"""
from __future__ import annotations
import logging
import socket
import threading

log = logging.getLogger("lattice.enrichment")

# ---------------------------------------------------------------------------
# OUI vendor lookup
# ---------------------------------------------------------------------------
# We bundle a compact OUI table (first 3 bytes of MAC → vendor name).
# The full IEEE list has 30k+ entries; this embedded subset covers the most
# common consumer hardware vendors. It falls back to a live fetch if missing.

_OUI_TABLE: dict[str, str] = {
    # Apple
    "00:03:93": "Apple", "00:0a:27": "Apple", "00:0a:95": "Apple",
    "00:1b:63": "Apple", "00:1c:b3": "Apple", "00:1d:4f": "Apple",
    "00:1e:52": "Apple", "00:1e:c2": "Apple", "00:1f:5b": "Apple",
    "00:1f:f3": "Apple", "00:21:e9": "Apple", "00:22:41": "Apple",
    "00:23:12": "Apple", "00:23:32": "Apple", "00:23:6c": "Apple",
    "00:23:df": "Apple", "00:24:36": "Apple", "00:25:00": "Apple",
    "00:25:4b": "Apple", "00:25:bc": "Apple", "00:26:08": "Apple",
    "00:26:4a": "Apple", "00:26:b9": "Apple", "00:26:bb": "Apple",
    "18:34:51": "Apple", "18:65:90": "Apple", "18:9e:fc": "Apple",
    "1c:ab:a7": "Apple", "20:c9:d0": "Apple", "24:a2:e1": "Apple",
    "28:6a:b8": "Apple", "28:cf:da": "Apple", "28:cf:e9": "Apple",
    "2c:be:08": "Apple", "34:15:9e": "Apple", "38:0f:4a": "Apple",
    "3c:07:54": "Apple", "40:30:04": "Apple", "44:2a:60": "Apple",
    "44:fb:42": "Apple", "48:43:7c": "Apple", "4c:57:ca": "Apple",
    "54:26:96": "Apple", "54:72:4f": "Apple", "54:ae:27": "Apple",
    "58:55:ca": "Apple", "5c:59:48": "Apple", "5c:f9:38": "Apple",
    "60:03:08": "Apple", "60:33:4b": "Apple", "60:69:44": "Apple",
    "60:c5:47": "Apple", "60:d9:c7": "Apple", "60:f4:45": "Apple",
    "64:20:0c": "Apple", "68:09:27": "Apple", "68:5b:35": "Apple",
    "6c:40:08": "Apple", "70:56:81": "Apple", "70:73:cb": "Apple",
    "74:81:14": "Apple", "78:4f:43": "Apple", "78:7b:8a": "Apple",
    "7c:04:d0": "Apple", "7c:6d:62": "Apple", "7c:d1:c3": "Apple",
    "80:be:05": "Apple", "84:38:35": "Apple", "84:78:8b": "Apple",
    "84:85:06": "Apple", "84:fc:ac": "Apple", "88:19:08": "Apple",
    "8c:2d:aa": "Apple", "90:27:e4": "Apple", "90:72:40": "Apple",
    "98:01:a7": "Apple", "98:03:d8": "Apple", "98:fe:94": "Apple",
    "9c:04:eb": "Apple", "9c:20:7b": "Apple", "9c:35:eb": "Apple",
    "a4:5e:60": "Apple", "a8:5c:2c": "Apple", "a8:60:b6": "Apple",
    "ac:22:0b": "Apple", "ac:29:3a": "Apple", "ac:7f:3e": "Apple",
    "b0:65:bd": "Apple", "b0:9f:ba": "Apple", "b4:18:d1": "Apple",
    "b8:09:8a": "Apple", "b8:17:c2": "Apple", "b8:53:ac": "Apple",
    "bc:3b:af": "Apple", "bc:52:b7": "Apple", "bc:67:78": "Apple",
    "c0:84:7a": "Apple", "c0:ce:cd": "Apple", "c4:2c:03": "Apple",
    "c8:33:4b": "Apple", "c8:69:cd": "Apple", "cc:08:8d": "Apple",
    "cc:29:f5": "Apple", "d0:03:4b": "Apple", "d0:25:98": "Apple",
    "d4:61:9d": "Apple", "d8:1d:72": "Apple", "dc:2b:2a": "Apple",
    "e0:ac:cb": "Apple", "e4:98:d6": "Apple", "e4:ce:8f": "Apple",
    "ec:85:2f": "Apple", "f0:18:98": "Apple", "f0:d1:a9": "Apple",
    "f4:f1:5a": "Apple", "f8:27:93": "Apple", "f8:62:aa": "Apple",
    "fc:25:3f": "Apple",
    # Samsung
    "00:00:f0": "Samsung", "00:02:78": "Samsung", "00:07:ab": "Samsung",
    "00:12:47": "Samsung", "00:15:b9": "Samsung", "00:16:32": "Samsung",
    "00:17:d5": "Samsung", "00:18:af": "Samsung", "00:1a:8a": "Samsung",
    "00:1b:98": "Samsung", "00:1c:43": "Samsung", "00:1d:25": "Samsung",
    "00:1e:7d": "Samsung", "00:1f:cc": "Samsung", "00:21:19": "Samsung",
    "00:23:39": "Samsung", "00:24:54": "Samsung", "00:25:66": "Samsung",
    "00:26:37": "Samsung", "04:18:d6": "Samsung", "08:08:c2": "Samsung",
    "08:37:3d": "Samsung", "0c:14:20": "Samsung", "10:1d:c0": "Samsung",
    "14:49:e0": "Samsung", "14:7d:c5": "Samsung", "18:3a:2d": "Samsung",
    "1c:62:b8": "Samsung", "20:6e:9c": "Samsung", "24:4b:81": "Samsung",
    "24:db:ac": "Samsung", "28:39:26": "Samsung", "28:ba:b5": "Samsung",
    "2c:ae:2b": "Samsung", "30:07:4d": "Samsung", "34:23:ba": "Samsung",
    "34:aa:8b": "Samsung", "38:0a:94": "Samsung", "38:2d:e8": "Samsung",
    "3c:5a:37": "Samsung", "3c:62:00": "Samsung", "40:0e:85": "Samsung",
    "44:65:0d": "Samsung", "48:44:f7": "Samsung", "4c:3c:16": "Samsung",
    "4c:bc:a5": "Samsung", "50:01:bb": "Samsung", "50:77:05": "Samsung",
    "54:88:0e": "Samsung", "58:ef:68": "Samsung", "5c:49:7d": "Samsung",
    "5c:f8:a1": "Samsung", "60:02:b4": "Samsung", "64:77:91": "Samsung",
    "64:b3:10": "Samsung", "68:27:37": "Samsung", "6c:83:36": "Samsung",
    "70:f9:27": "Samsung", "74:45:8a": "Samsung", "78:1f:db": "Samsung",
    "78:40:e4": "Samsung", "7c:0b:c6": "Samsung", "80:57:19": "Samsung",
    "84:25:db": "Samsung", "84:51:81": "Samsung", "84:55:a5": "Samsung",
    "88:32:9b": "Samsung", "8c:71:f8": "Samsung", "90:18:7c": "Samsung",
    "90:f1:aa": "Samsung", "94:35:0a": "Samsung", "94:63:d1": "Samsung",
    "98:52:b1": "Samsung", "98:aa:fc": "Samsung", "9c:02:98": "Samsung",
    "a0:07:98": "Samsung", "a0:21:b7": "Samsung", "a0:b4:a5": "Samsung",
    "a4:eb:d3": "Samsung", "a8:06:00": "Samsung", "a8:9f:ba": "Samsung",
    "ac:36:13": "Samsung", "b0:72:bf": "Samsung", "b4:07:f9": "Samsung",
    "b4:3a:28": "Samsung", "bc:20:a4": "Samsung", "bc:85:56": "Samsung",
    "c0:65:99": "Samsung", "c4:57:6e": "Samsung", "c4:88:e5": "Samsung",
    "c8:14:51": "Samsung", "cc:05:1b": "Samsung", "d0:22:be": "Samsung",
    "d4:87:d8": "Samsung", "d4:e8:b2": "Samsung", "d8:57:ef": "Samsung",
    "dc:d3:84": "Samsung", "e0:99:71": "Samsung", "e4:40:e2": "Samsung",
    "e8:03:9a": "Samsung", "ec:1f:72": "Samsung", "f0:25:b7": "Samsung",
    "f0:5a:09": "Samsung", "f4:7b:5e": "Samsung", "f8:04:2e": "Samsung",
    # Google
    "00:1a:11": "Google", "08:9e:08": "Google", "20:df:b9": "Google",
    "48:d6:d5": "Google", "54:60:09": "Google", "54:f2:01": "Google",
    "6c:ad:f8": "Google", "94:eb:2c": "Google", "a4:77:33": "Google",
    "b0:e0:3c": "Google", "d4:f5:47": "Google", "dc:e5:5b": "Google",
    "e4:f0:42": "Google", "f4:f5:d8": "Google",
    # Amazon
    "00:bb:3a": "Amazon", "0c:47:c9": "Amazon", "34:d2:70": "Amazon",
    "40:b4:cd": "Amazon", "44:65:0d": "Amazon", "50:f5:da": "Amazon",
    "68:37:e9": "Amazon", "74:c2:46": "Amazon", "84:d6:d0": "Amazon",
    "a0:02:dc": "Amazon", "b4:7c:9c": "Amazon", "f0:27:65": "Amazon",
    "fc:65:de": "Amazon",
    # Raspberry Pi Foundation
    "28:cd:c1": "Raspberry Pi", "b8:27:eb": "Raspberry Pi",
    "d8:3a:dd": "Raspberry Pi", "dc:a6:32": "Raspberry Pi",
    "e4:5f:01": "Raspberry Pi",
    # Cisco
    "00:00:0c": "Cisco", "00:01:42": "Cisco", "00:01:43": "Cisco",
    "00:01:64": "Cisco", "00:01:96": "Cisco", "00:01:97": "Cisco",
    "00:02:16": "Cisco", "00:02:17": "Cisco", "00:03:6b": "Cisco",
    "00:03:e3": "Cisco", "00:04:9a": "Cisco", "00:04:c0": "Cisco",
    "00:05:00": "Cisco", "00:05:31": "Cisco", "00:05:32": "Cisco",
    "00:06:28": "Cisco", "00:07:0d": "Cisco", "00:07:7d": "Cisco",
    "00:08:a3": "Cisco", "00:08:e3": "Cisco", "00:09:11": "Cisco",
    "00:09:43": "Cisco", "00:09:7b": "Cisco", "00:09:b7": "Cisco",
    "00:0a:41": "Cisco", "00:0a:42": "Cisco", "00:0a:b8": "Cisco",
    "00:0b:45": "Cisco", "00:0b:46": "Cisco", "00:0b:5f": "Cisco",
    "00:0b:60": "Cisco", "00:0b:fd": "Cisco", "00:0c:30": "Cisco",
    "00:0c:31": "Cisco", "00:0c:85": "Cisco", "00:0c:86": "Cisco",
    "00:0d:28": "Cisco", "00:0d:29": "Cisco", "00:0d:65": "Cisco",
    "00:0d:66": "Cisco", "00:0d:bc": "Cisco", "00:0d:bd": "Cisco",
    "00:0e:38": "Cisco", "00:0e:39": "Cisco", "00:0e:83": "Cisco",
    "00:0e:84": "Cisco", "00:0e:d6": "Cisco", "00:0e:d7": "Cisco",
    "00:0f:23": "Cisco", "00:0f:24": "Cisco", "00:0f:34": "Cisco",
    "00:0f:35": "Cisco", "00:0f:8f": "Cisco", "00:0f:90": "Cisco",
    # Netgear
    "00:09:5b": "Netgear", "00:0f:b5": "Netgear", "00:14:6c": "Netgear",
    "00:18:4d": "Netgear", "00:1b:2f": "Netgear", "00:1e:2a": "Netgear",
    "00:22:3f": "Netgear", "00:24:b2": "Netgear", "00:26:f2": "Netgear",
    "04:a1:51": "Netgear", "08:02:8e": "Netgear", "0c:3d:c9": "Netgear",
    "10:0d:7f": "Netgear", "10:da:43": "Netgear", "14:59:c0": "Netgear",
    "1c:1b:0d": "Netgear", "20:4e:7f": "Netgear", "24:f5:a2": "Netgear",
    "28:c6:8e": "Netgear", "2c:30:33": "Netgear", "30:46:9a": "Netgear",
    "44:94:fc": "Netgear", "4c:60:de": "Netgear", "6c:b0:ce": "Netgear",
    "74:44:01": "Netgear", "84:1b:5e": "Netgear", "9c:3d:cf": "Netgear",
    "a0:21:b7": "Netgear", "a4:2b:8c": "Netgear", "c0:3f:0e": "Netgear",
    "c4:04:15": "Netgear", "e0:46:9a": "Netgear", "e0:91:f5": "Netgear",
    # TP-Link
    "00:1d:0f": "TP-Link", "14:cc:20": "TP-Link", "18:a6:f7": "TP-Link",
    "1c:3b:f3": "TP-Link", "50:c7:bf": "TP-Link", "54:a7:03": "TP-Link",
    "60:32:b1": "TP-Link", "64:70:02": "TP-Link", "6c:5a:b0": "TP-Link",
    "70:4f:57": "TP-Link", "74:da:38": "TP-Link", "78:8a:20": "TP-Link",
    "90:f6:52": "TP-Link", "98:da:c4": "TP-Link", "a0:f3:c1": "TP-Link",
    "b0:48:7a": "TP-Link", "c4:e9:84": "TP-Link", "d8:07:b6": "TP-Link",
    "e8:de:27": "TP-Link", "ec:08:6b": "TP-Link", "f4:ec:38": "TP-Link",
    # Intel (wireless NICs)
    "00:02:b3": "Intel", "00:03:47": "Intel", "00:04:23": "Intel",
    "00:07:e9": "Intel", "00:0c:f1": "Intel", "00:0d:56": "Intel",
    "00:0e:0c": "Intel", "00:0e:35": "Intel", "00:11:75": "Intel",
    "00:11:11": "Intel", "00:12:f0": "Intel", "00:13:02": "Intel",
    "00:13:20": "Intel", "00:13:ce": "Intel", "00:13:e8": "Intel",
    "00:15:00": "Intel", "00:16:76": "Intel", "00:18:de": "Intel",
    "00:19:d1": "Intel", "00:1b:21": "Intel", "00:1c:c0": "Intel",
    "00:1d:e0": "Intel", "00:1e:64": "Intel", "00:1e:65": "Intel",
    "00:1f:3b": "Intel", "00:1f:3c": "Intel", "00:21:5c": "Intel",
    "00:21:5d": "Intel", "00:22:fa": "Intel", "00:22:fb": "Intel",
    "00:23:14": "Intel", "00:23:15": "Intel", "00:24:d7": "Intel",
    "00:27:10": "Intel", "40:25:c2": "Intel", "40:f0:2f": "Intel",
    "48:51:b7": "Intel", "4c:34:88": "Intel", "60:57:18": "Intel",
    "64:80:99": "Intel", "68:05:ca": "Intel", "7c:7a:91": "Intel",
    "80:19:34": "Intel", "84:3a:4b": "Intel", "8c:8d:28": "Intel",
    "8c:ec:4b": "Intel", "90:2e:16": "Intel", "94:65:9c": "Intel",
    "a4:c3:f0": "Intel", "a8:7e:ea": "Intel", "ac:72:89": "Intel",
    "b8:ae:ed": "Intel", "c4:d9:87": "Intel", "d8:fc:93": "Intel",
    "e0:94:67": "Intel",
    # Ubiquiti
    "00:15:6d": "Ubiquiti", "00:27:22": "Ubiquiti", "04:18:d6": "Ubiquiti",
    "18:e8:29": "Ubiquiti", "24:a4:3c": "Ubiquiti", "44:d9:e7": "Ubiquiti",
    "68:72:51": "Ubiquiti", "74:83:c2": "Ubiquiti", "78:8a:20": "Ubiquiti",
    "80:2a:a8": "Ubiquiti", "b4:fb:e4": "Ubiquiti", "dc:9f:db": "Ubiquiti",
    "e0:63:da": "Ubiquiti", "f4:92:bf": "Ubiquiti", "fc:ec:da": "Ubiquiti",
    # Microsoft
    "00:03:ff": "Microsoft", "00:0d:3a": "Microsoft", "00:12:5a": "Microsoft",
    "00:15:5d": "Microsoft", "00:17:fa": "Microsoft", "00:50:f2": "Microsoft",
    "28:18:78": "Microsoft", "28:16:ad": "Microsoft", "48:50:73": "Microsoft",
    "50:1a:c5": "Microsoft", "60:45:bd": "Microsoft", "7c:1e:52": "Microsoft",
}

_oui_lock = threading.Lock()


def lookup_vendor(mac: str) -> str:
    """Return the vendor name for a MAC address."""
    if not mac or mac == "00:00:00:00:00:00":
        return "Unknown"

    # Normalise to lower-case colon-separated
    mac_norm = mac.lower().replace("-", ":")
    prefix = mac_norm[:8]

    with _oui_lock:
        vendor = _OUI_TABLE.get(prefix)

    if vendor:
        return vendor

    # Try 6-char prefix (some tables use only first 3 bytes without colons)
    prefix6 = mac_norm.replace(":", "")[:6]
    with _oui_lock:
        for key, val in _OUI_TABLE.items():
            if key.replace(":", "") == prefix6:
                return val

    return "Unknown"


# ---------------------------------------------------------------------------
# Reverse DNS
# ---------------------------------------------------------------------------

def resolve_hostname(ip: str, timeout: float = 1.0) -> str:
    """Resolve an IP address to a hostname. Returns empty string on failure."""
    try:
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(timeout)
        try:
            hostname, _, _ = socket.gethostbyaddr(ip)
            return hostname
        finally:
            socket.setdefaulttimeout(old_timeout)
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Device type guesser
# ---------------------------------------------------------------------------

def guess_device_type(vendor: str, open_ports: list[int]) -> str:
    """Return a rough device type label based on vendor and open ports."""
    vendor_l = vendor.lower()

    if any(v in vendor_l for v in ["apple", "samsung", "google", "amazon"]):
        if 62078 in open_ports:  # iOS pairing port
            return "iPhone/iPad"
        if any(p in open_ports for p in [5555, 5037]):  # ADB
            return "Android Device"
        return "Mobile / Smart Device"

    if "raspberry" in vendor_l:
        return "Raspberry Pi"

    if any(v in vendor_l for v in ["cisco", "netgear", "tp-link", "ubiquiti", "asus", "linksys", "dlink", "d-link"]):
        if any(p in open_ports for p in [80, 443, 8080, 8443]):
            return "Router / AP"
        return "Network Equipment"

    if any(p in open_ports for p in [22, 2222]):
        return "Server (SSH)"

    if any(p in open_ports for p in [80, 443, 8080, 8443]):
        return "Web Server"

    if 3389 in open_ports:
        return "Windows PC (RDP)"

    if any(p in open_ports for p in [548, 5009]):
        return "NAS / macOS"

    if any(p in open_ports for p in [1883, 8883]):
        return "IoT Device (MQTT)"

    return "Unknown"
