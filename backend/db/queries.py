"""Typed query helpers that wrap database.py."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from models.schemas import Device, Connection, TrafficPoint
import db.database as db


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

def upsert_device(device: Device) -> None:
    db.execute("""
        INSERT INTO devices (ip, mac, vendor, hostname, os_guess, open_ports, first_seen, last_seen, is_alive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ip) DO UPDATE SET
            mac       = EXCLUDED.mac,
            vendor    = EXCLUDED.vendor,
            hostname  = CASE WHEN EXCLUDED.hostname != '' THEN EXCLUDED.hostname ELSE devices.hostname END,
            os_guess  = CASE WHEN EXCLUDED.os_guess  != '' THEN EXCLUDED.os_guess  ELSE devices.os_guess  END,
            open_ports= CASE WHEN EXCLUDED.open_ports != '[]' THEN EXCLUDED.open_ports ELSE devices.open_ports END,
            last_seen = EXCLUDED.last_seen,
            is_alive  = EXCLUDED.is_alive
    """, [
        device.ip, device.mac, device.vendor, device.hostname,
        device.os_guess, json.dumps(device.open_ports),
        device.first_seen, device.last_seen, device.is_alive,
    ])


def mark_device_dead(ip: str) -> None:
    db.execute("UPDATE devices SET is_alive = FALSE WHERE ip = ?", [ip])


def get_all_devices() -> list[Device]:
    rows = db.fetchall("""
        SELECT ip, mac, vendor, hostname, os_guess, open_ports, first_seen, last_seen, is_alive
        FROM devices
        ORDER BY ip
    """)
    result = []
    for row in rows:
        ip, mac, vendor, hostname, os_guess, open_ports_json, first_seen, last_seen, is_alive = row
        result.append(Device(
            ip=ip, mac=mac, vendor=vendor, hostname=hostname,
            os_guess=os_guess,
            open_ports=json.loads(open_ports_json or "[]"),
            first_seen=first_seen, last_seen=last_seen,
            is_alive=bool(is_alive),
        ))
    return result


def get_device(ip: str) -> Device | None:
    row = db.fetchone("""
        SELECT ip, mac, vendor, hostname, os_guess, open_ports, first_seen, last_seen, is_alive
        FROM devices WHERE ip = ?
    """, [ip])
    if not row:
        return None
    ip, mac, vendor, hostname, os_guess, open_ports_json, first_seen, last_seen, is_alive = row
    return Device(
        ip=ip, mac=mac, vendor=vendor, hostname=hostname,
        os_guess=os_guess,
        open_ports=json.loads(open_ports_json or "[]"),
        first_seen=first_seen, last_seen=last_seen,
        is_alive=bool(is_alive),
    )


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------

def insert_connection(conn: Connection) -> None:
    db.execute("""
        INSERT INTO connections (ts, src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        conn.ts, conn.src_ip, conn.dst_ip, conn.src_port,
        conn.dst_port, conn.protocol, conn.bytes, conn.packets,
    ])


def get_recent_connections(limit: int = 50) -> list[Connection]:
    rows = db.fetchall(f"""
        SELECT ts, src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets
        FROM connections
        ORDER BY ts DESC
        LIMIT {limit}
    """)
    return [Connection(
        ts=row[0], src_ip=row[1], dst_ip=row[2],
        src_port=row[3], dst_port=row[4], protocol=row[5],
        bytes=row[6], packets=row[7],
    ) for row in rows]


def get_protocol_counts(minutes: int = 60) -> dict[str, int]:
    rows = db.fetchall("""
        SELECT protocol, COUNT(*) as cnt
        FROM connections
        WHERE ts >= NOW() - INTERVAL '? minutes'
        GROUP BY protocol
        ORDER BY cnt DESC
    """.replace("? minutes", f"{minutes} minutes"))
    return {row[0]: row[1] for row in rows}


# ---------------------------------------------------------------------------
# Traffic stats
# ---------------------------------------------------------------------------

def upsert_traffic_stat(stat: TrafficPoint) -> None:
    """Upsert a 1-minute traffic bucket for a given IP."""
    db.execute("""
        INSERT INTO traffic_stats (ts, ip, bytes_out, bytes_in, packets_out, packets_in)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (ts, ip) DO UPDATE SET
            bytes_out   = traffic_stats.bytes_out   + EXCLUDED.bytes_out,
            bytes_in    = traffic_stats.bytes_in    + EXCLUDED.bytes_in,
            packets_out = traffic_stats.packets_out + EXCLUDED.packets_out,
            packets_in  = traffic_stats.packets_in  + EXCLUDED.packets_in
    """, [stat.ts, stat.ip, stat.bytes_out, stat.bytes_in, stat.packets_out, stat.packets_in])


def get_traffic_history(ip: str | None, hours: int = 1) -> list[dict]:
    """Return bucketed traffic history. ip=None means aggregate all."""
    if ip:
        rows = db.fetchall("""
            SELECT DATE_TRUNC('minute', ts) as bucket, ip,
                   SUM(bytes_out) as bytes_out, SUM(bytes_in) as bytes_in
            FROM traffic_stats
            WHERE ip = ?
              AND ts >= NOW() - INTERVAL '? hours'
            GROUP BY bucket, ip
            ORDER BY bucket
        """.replace("? hours", f"{hours} hours"), [ip])
    else:
        rows = db.fetchall("""
            SELECT DATE_TRUNC('minute', ts) as bucket, 'all' as ip,
                   SUM(bytes_out) as bytes_out, SUM(bytes_in) as bytes_in
            FROM traffic_stats
            WHERE ts >= NOW() - INTERVAL '? hours'
            GROUP BY bucket
            ORDER BY bucket
        """.replace("? hours", f"{hours} hours"))

    return [{"ts": str(r[0]), "ip": r[1], "bytes_out": r[2], "bytes_in": r[3]} for r in rows]


def get_top_talkers(limit: int = 10, minutes: int = 10) -> list[dict]:
    rows = db.fetchall("""
        SELECT ip, SUM(bytes_out) as total_out, SUM(bytes_in) as total_in
        FROM traffic_stats
        WHERE ts >= NOW() - INTERVAL '? minutes'
        GROUP BY ip
        ORDER BY total_out DESC
        LIMIT ?
    """.replace("? minutes", f"{minutes} minutes"), [limit])
    return [{"ip": r[0], "bytes_out": r[1], "bytes_in": r[2]} for r in rows]


def purge_old_data(retention_days: int) -> None:
    db.execute("""
        DELETE FROM connections
        WHERE ts < NOW() - INTERVAL '? days'
    """.replace("? days", f"{retention_days} days"))
    db.execute("""
        DELETE FROM traffic_stats
        WHERE ts < NOW() - INTERVAL '? days'
    """.replace("? days", f"{retention_days} days"))
