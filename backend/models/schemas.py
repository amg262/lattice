"""Pydantic models shared across API and engines."""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class Device(BaseModel):
    ip: str
    mac: str
    vendor: str = "Unknown"
    hostname: str = ""
    os_guess: str = ""
    open_ports: list[int] = []
    first_seen: datetime
    last_seen: datetime
    is_alive: bool = True
    bytes_out: int = 0
    bytes_in: int = 0


class Connection(BaseModel):
    ts: datetime
    src_ip: str
    dst_ip: str
    src_port: Optional[int] = None
    dst_port: Optional[int] = None
    protocol: str
    bytes: int = 0
    packets: int = 0


class TrafficPoint(BaseModel):
    ts: datetime
    ip: str
    bytes_out: int
    bytes_in: int
    packets_out: int
    packets_in: int


class WSMessage(BaseModel):
    type: str  # "snapshot" | "device_added" | "device_updated"
    devices: list[Device] = []
    connections: list[Connection] = []
    traffic: list[TrafficPoint] = []
    top_talkers: list[dict] = []
    protocol_counts: dict[str, int] = {}
    stats: dict = {}
