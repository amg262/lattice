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


# ---------------------------------------------------------------------------
# Geo cache
# ---------------------------------------------------------------------------

def upsert_geo(geo: dict) -> None:
    """Persist a geo record to DuckDB (upsert by IP)."""
    db.execute("""
        INSERT INTO geo_cache (ip, lat, lon, city, country, country_code, isp, org, as_name, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ip) DO UPDATE SET
            lat          = EXCLUDED.lat,
            lon          = EXCLUDED.lon,
            city         = EXCLUDED.city,
            country      = EXCLUDED.country,
            country_code = EXCLUDED.country_code,
            isp          = EXCLUDED.isp,
            org          = EXCLUDED.org,
            as_name      = EXCLUDED.as_name
    """, [
        geo["ip"], geo["lat"], geo["lon"],
        geo.get("city", ""), geo.get("country", ""), geo.get("country_code", ""),
        geo.get("isp", ""), geo.get("org", ""), geo.get("as_name", ""),
        datetime.now(timezone.utc),
    ])


def get_geo(ip: str) -> dict | None:
    row = db.fetchone("""
        SELECT ip, lat, lon, city, country, country_code, isp, org, as_name
        FROM geo_cache WHERE ip = ?
    """, [ip])
    if not row:
        return None
    return {
        "ip": row[0], "lat": row[1], "lon": row[2],
        "city": row[3], "country": row[4], "country_code": row[5],
        "isp": row[6], "org": row[7], "as_name": row[8],
    }


def get_all_geo() -> list[dict]:
    rows = db.fetchall("""
        SELECT ip, lat, lon, city, country, country_code, isp, org, as_name
        FROM geo_cache
    """)
    return [
        {
            "ip": r[0], "lat": r[1], "lon": r[2],
            "city": r[3], "country": r[4], "country_code": r[5],
            "isp": r[6], "org": r[7], "as_name": r[8],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# DNS log
# ---------------------------------------------------------------------------

def insert_dns_query(ts, src_ip: str, domain: str, query_type: str = "DNS") -> None:
    db.execute("""
        INSERT INTO dns_log (ts, src_ip, domain, query_type)
        VALUES (?, ?, ?, ?)
    """, [ts, src_ip, domain, query_type])


def get_dns_log(ip: str | None = None, hours: int = 1, limit: int = 200) -> list[dict]:
    if ip:
        rows = db.fetchall(f"""
            SELECT ts, src_ip, domain, query_type
            FROM dns_log
            WHERE src_ip = ?
              AND ts >= NOW() - INTERVAL '{hours} hours'
            ORDER BY ts DESC
            LIMIT {limit}
        """, [ip])
    else:
        rows = db.fetchall(f"""
            SELECT ts, src_ip, domain, query_type
            FROM dns_log
            WHERE ts >= NOW() - INTERVAL '{hours} hours'
            ORDER BY ts DESC
            LIMIT {limit}
        """)
    return [{"ts": str(r[0]), "src_ip": r[1], "domain": r[2], "query_type": r[3]} for r in rows]


def get_top_domains(ip: str | None = None, hours: int = 24, limit: int = 20) -> list[dict]:
    if ip:
        rows = db.fetchall(f"""
            SELECT domain, query_type, COUNT(*) as cnt
            FROM dns_log
            WHERE src_ip = ?
              AND ts >= NOW() - INTERVAL '{hours} hours'
            GROUP BY domain, query_type
            ORDER BY cnt DESC
            LIMIT {limit}
        """, [ip])
    else:
        rows = db.fetchall(f"""
            SELECT domain, query_type, COUNT(*) as cnt
            FROM dns_log
            WHERE ts >= NOW() - INTERVAL '{hours} hours'
            GROUP BY domain, query_type
            ORDER BY cnt DESC
            LIMIT {limit}
        """)
    return [{"domain": r[0], "query_type": r[1], "count": r[2]} for r in rows]


def get_dns_counts_by_device(hours: int = 1) -> dict[str, int]:
    """Return {ip: query_count} for the given time window."""
    rows = db.fetchall(f"""
        SELECT src_ip, COUNT(*) as cnt
        FROM dns_log
        WHERE ts >= NOW() - INTERVAL '{hours} hours'
        GROUP BY src_ip
    """)
    return {r[0]: r[1] for r in rows}


# ---------------------------------------------------------------------------
# Events / Alerts
# ---------------------------------------------------------------------------

def insert_event(ts, severity: str, device_ip: str, event_type: str, message: str) -> None:
    db.execute("""
        INSERT INTO events (ts, severity, device_ip, event_type, message)
        VALUES (?, ?, ?, ?, ?)
    """, [ts, severity, device_ip, event_type, message])


def get_events(hours: int = 24, severity: str | None = None, limit: int = 100) -> list[dict]:
    if severity:
        rows = db.fetchall(f"""
            SELECT ts, severity, device_ip, event_type, message
            FROM events
            WHERE severity = ?
              AND ts >= NOW() - INTERVAL '{hours} hours'
            ORDER BY ts DESC
            LIMIT {limit}
        """, [severity])
    else:
        rows = db.fetchall(f"""
            SELECT ts, severity, device_ip, event_type, message
            FROM events
            WHERE ts >= NOW() - INTERVAL '{hours} hours'
            ORDER BY ts DESC
            LIMIT {limit}
        """)
    return [
        {"ts": str(r[0]), "severity": r[1], "device_ip": r[2], "event_type": r[3], "message": r[4]}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Traffic usage
# ---------------------------------------------------------------------------

def get_traffic_usage(ip: str | None = None, period: str = "day") -> list[dict]:
    """Aggregate traffic by IP for a given period (day/week/month)."""
    period_map = {"day": "1 days", "week": "7 days", "month": "30 days"}
    interval = period_map.get(period, "1 days")
    if ip:
        rows = db.fetchall(f"""
            SELECT DATE_TRUNC('day', ts) as day,
                   SUM(bytes_out) as bytes_out,
                   SUM(bytes_in) as bytes_in
            FROM traffic_stats
            WHERE ip = ?
              AND ts >= NOW() - INTERVAL '{interval}'
            GROUP BY day
            ORDER BY day
        """, [ip])
        return [{"day": str(r[0]), "bytes_out": r[1] or 0, "bytes_in": r[2] or 0} for r in rows]
    else:
        rows = db.fetchall(f"""
            SELECT ip,
                   SUM(bytes_out) as bytes_out,
                   SUM(bytes_in) as bytes_in
            FROM traffic_stats
            WHERE ts >= NOW() - INTERVAL '{interval}'
            GROUP BY ip
            ORDER BY bytes_out DESC
        """)
        return [{"ip": r[0], "bytes_out": r[1] or 0, "bytes_in": r[2] or 0} for r in rows]


# ---------------------------------------------------------------------------
# Device activity (merged connections + dns_log)
# ---------------------------------------------------------------------------

def get_device_activity(ip: str, hours: int = 24, limit: int = 100) -> list[dict]:
    """Return merged timeline of connections and DNS queries for a device."""
    rows = db.fetchall(f"""
        SELECT ts, 'dns' as kind, domain as detail, query_type as proto, '' as dst_ip
        FROM dns_log
        WHERE src_ip = ?
          AND ts >= NOW() - INTERVAL '{hours} hours'
        UNION ALL
        SELECT ts, 'conn' as kind, dst_ip as detail, protocol as proto, dst_ip
        FROM connections
        WHERE src_ip = ?
          AND ts >= NOW() - INTERVAL '{hours} hours'
        ORDER BY ts DESC
        LIMIT {limit}
    """, [ip, ip])
    return [
        {"ts": str(r[0]), "kind": r[1], "detail": r[2], "proto": r[3], "dst_ip": r[4]}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------

def purge_old_data(retention_days: int) -> None:
    db.execute(f"DELETE FROM connections WHERE ts < NOW() - INTERVAL '{retention_days} days'")
    db.execute(f"DELETE FROM traffic_stats WHERE ts < NOW() - INTERVAL '{retention_days} days'")
    db.execute(f"DELETE FROM dns_log WHERE ts < NOW() - INTERVAL '{retention_days} days'")
    db.execute(f"DELETE FROM events WHERE ts < NOW() - INTERVAL '{retention_days * 4} days'")
