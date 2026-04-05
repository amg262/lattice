# Lattice — Local Network Intelligence Dashboard

A real-time, self-hosted network monitoring dashboard with a Palantir-style dark UI. Visualizes live device topology, traffic flows, connection feeds, bandwidth timelines, and protocol distributions for your local network.

---

## What It Shows

- **Topology Graph** — force-directed map of every device on your LAN with animated traffic edges
- **Live Connection Feed** — streaming packet capture (src/dst IP, protocol, port, bytes)
- **Bandwidth Timeline** — per-device and aggregate traffic over selectable time windows
- **Top Talkers** — ranked devices by outbound traffic volume
- **Protocol Distribution** — donut chart of DNS, HTTP, TLS, ARP, ICMP, etc.
- **Device Panel** — MAC address, vendor, hostname, open ports, OS guess, first/last seen

---

## Prerequisites

### System Requirements
- Windows 10/11 (64-bit)
- Python 3.12+
- Node.js 20+

### Required System Installs

1. **Nmap** — [https://nmap.org/download.html](https://nmap.org/download.html)
   - During install, check **"Add Nmap to PATH"**
   - Used for port scanning and OS fingerprinting

2. **Npcap** — [https://npcap.com/](https://npcap.com/)
   - During install, check **"Install Npcap in WinPcap API-compatible Mode"**
   - Required for raw packet capture (replaces deprecated WinPcap)

3. **Wireshark** (optional but recommended) — [https://www.wireshark.org/download.html](https://www.wireshark.org/download.html)
   - Provides `tshark` for deep protocol dissection
   - If not installed, pyshark features are skipped gracefully

---

## Setup

### Backend

```powershell
# Must run as Administrator for packet capture and SYN scanning
cd backend
pip install -r requirements.txt
```

Edit `config.py` if you want to pin a specific network interface or subnet. By default the backend auto-detects your primary interface and subnet.

### Frontend

```powershell
cd frontend
npm install
```

---

## Running

### Start the Backend (as Administrator)

```powershell
# Open PowerShell as Administrator
cd backend
python main.py
```

Backend runs at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

### Start the Frontend

```powershell
cd frontend
npm run dev
```

Dashboard runs at `http://localhost:5173`.

---

## Configuration (`backend/config.py`)

| Setting | Default | Description |
|---|---|---|
| `INTERFACE` | `None` (auto-detect) | Network interface name for packet capture |
| `SUBNET` | `None` (auto-detect) | Subnet to scan, e.g. `192.168.1.0/24` |
| `ARP_SWEEP_INTERVAL` | `30` | Seconds between ARP sweeps for device discovery |
| `NMAP_SCAN_INTERVAL` | `300` | Seconds between full nmap port/OS scans |
| `WS_PUSH_INTERVAL` | `2` | Seconds between WebSocket pushes to frontend |
| `MAX_CONNECTIONS_HISTORY` | `500` | Max connection events kept in memory |
| `DB_PATH` | `lattice.duckdb` | Path to DuckDB database file |

---

## Architecture

```
Browser (localhost:5173)
    │
    ├── WebSocket /ws  ──────────────────────────────────────────────┐
    └── REST /api/...  ─────────────────────────────────────────┐   │
                                                                 │   │
                        FastAPI Backend (localhost:8000)         │   │
                        ┌─────────────────────────────┐         │   │
                        │  Scan Engine (scapy + nmap)  │         │   │
                        │  Capture Engine (scapy)      │─► DuckDB│   │
                        │  Enrichment (OUI + rDNS)     │         │   │
                        │  REST API ──────────────────────────────┘   │
                        │  WS Broadcaster ───────────────────────────┘
                        └─────────────────────────────┘
```

---

## Database

DuckDB is used as an embedded database — no separate server process required. The `lattice.duckdb` file is created automatically on first run in the `backend/` directory.

**Tables:**
- `devices` — discovered devices with metadata
- `connections` — packet-level connection events
- `traffic_stats` — 1-minute aggregated bandwidth per device

---

## Permissions Note

The backend **must run as Administrator** on Windows for:
- Raw packet capture (Npcap/scapy)
- SYN port scanning (nmap `-sS`)
- OS fingerprinting (nmap `-O`)

Without admin rights, it falls back to ICMP ping discovery and TCP connect scanning (slower, less accurate).

---

## Development

```powershell
# Backend with auto-reload
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend with HMR
cd frontend
npm run dev
```

---

## Dependencies

### Backend
- `fastapi` + `uvicorn` — async web framework and ASGI server
- `scapy` — packet crafting, ARP sweeps, packet capture
- `python-libnmap` — nmap port/OS scanning
- `duckdb` — embedded columnar database
- `psutil` — system network interface enumeration
- `websockets` — WebSocket support

### Frontend
- `react` + `vite` + `typescript`
- `vis-network` — force-directed topology graph
- `recharts` — time-series and statistical charts
- `zustand` — lightweight state management
- `tailwindcss` — utility-first dark theme styling
