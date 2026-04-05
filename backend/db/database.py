"""DuckDB connection management and schema initialisation."""
from __future__ import annotations
import threading
import duckdb
import config

_lock = threading.Lock()
_conn: duckdb.DuckDBPyConnection | None = None


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return the shared DuckDB connection (thread-safe via lock)."""
    global _conn
    if _conn is None:
        _conn = duckdb.connect(config.DB_PATH)
        _init_schema(_conn)
    return _conn


def _init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            ip          VARCHAR PRIMARY KEY,
            mac         VARCHAR NOT NULL,
            vendor      VARCHAR DEFAULT 'Unknown',
            hostname    VARCHAR DEFAULT '',
            os_guess    VARCHAR DEFAULT '',
            open_ports  VARCHAR DEFAULT '[]',   -- JSON array stored as text
            first_seen  TIMESTAMP NOT NULL,
            last_seen   TIMESTAMP NOT NULL,
            is_alive    BOOLEAN DEFAULT TRUE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS connections (
            ts          TIMESTAMP NOT NULL,
            src_ip      VARCHAR NOT NULL,
            dst_ip      VARCHAR NOT NULL,
            src_port    INTEGER,
            dst_port    INTEGER,
            protocol    VARCHAR NOT NULL,
            bytes       BIGINT DEFAULT 0,
            packets     INTEGER DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_connections_ts
        ON connections (ts)
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS traffic_stats (
            ts          TIMESTAMP NOT NULL,
            ip          VARCHAR NOT NULL,
            bytes_out   BIGINT DEFAULT 0,
            bytes_in    BIGINT DEFAULT 0,
            packets_out INTEGER DEFAULT 0,
            packets_in  INTEGER DEFAULT 0,
            PRIMARY KEY (ts, ip)
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_traffic_ts
        ON traffic_stats (ts)
    """)


def execute(sql: str, params: list | None = None):
    """Thread-safe query execution, returns nothing."""
    with _lock:
        conn = get_conn()
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)


def fetchall(sql: str, params: list | None = None) -> list:
    """Thread-safe SELECT, returns list of tuples."""
    with _lock:
        conn = get_conn()
        if params:
            return conn.execute(sql, params).fetchall()
        return conn.execute(sql).fetchall()


def fetchone(sql: str, params: list | None = None):
    """Thread-safe SELECT, returns single row or None."""
    with _lock:
        conn = get_conn()
        if params:
            return conn.execute(sql, params).fetchone()
        return conn.execute(sql).fetchone()
