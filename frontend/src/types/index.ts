export interface Device {
  ip: string
  mac: string
  vendor: string
  hostname: string
  os_guess: string
  open_ports: number[]
  first_seen: string
  last_seen: string
  is_alive: boolean
  bytes_out: number
  bytes_in: number
}

export interface Connection {
  ts: string
  src_ip: string
  dst_ip: string
  src_port: number | null
  dst_port: number | null
  protocol: string
  bytes: number
  packets: number
}

export interface TrafficPoint {
  ts: string
  ip: string
  bytes_out: number
  bytes_in: number
}

export interface Talker {
  ip: string
  bytes_out: number
  bytes_in: number
}

export interface ProtocolEntry {
  protocol: string
  count: number
  pct: number
}

export interface Stats {
  total_devices: number
  alive_devices: number
  top_protocol: string
}

export interface WSSnapshot {
  type: string
  ts: string
  stats: Stats
  devices: Device[]
  connections: Connection[]
  top_talkers: Talker[]
  protocol_distribution: ProtocolEntry[]
}
