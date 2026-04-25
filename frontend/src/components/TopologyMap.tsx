import { useEffect, useRef } from 'react'
import { Network, DataSet } from 'vis-network/standalone'
import type { Options } from 'vis-network'
import { useNetworkStore } from '../stores/networkStore'
import type { Device, Connection } from '../types'

// Protocol → edge color for traffic flows
const PROTO_COLORS: Record<string, string> = {
  DNS: '#f59e0b',
  HTTP: '#3b82f6',
  TLS: '#22c55e',
  SSH: '#a78bfa',
  ICMP: '#94a3b8',
  ARP: '#64748b',
  TCP: '#60a5fa',
  UDP: '#34d399',
  DHCP: '#fb923c',
  NTP: '#c084fc',
  Other: '#475569',
}

function getProtoColor(proto: string): string {
  return PROTO_COLORS[proto] ?? PROTO_COLORS.Other
}

function deviceLabel(d: Device): string {
  const name = d.hostname || d.vendor || d.ip
  return `${name}\n${d.ip}`
}

function deviceColor(d: Device) {
  if (!d.is_alive) return { background: '#1c2230', border: '#2d3748', highlight: { background: '#21283a', border: '#475569' } }
  if (d.vendor.toLowerCase().includes('apple')) return { background: '#1a2535', border: '#3b82f6', highlight: { background: '#1e2d45', border: '#60a5fa' } }
  if (d.vendor.toLowerCase().includes('google')) return { background: '#1a2a20', border: '#22c55e', highlight: { background: '#1e3326', border: '#4ade80' } }
  if (d.vendor.toLowerCase().includes('samsung')) return { background: '#1e2535', border: '#6366f1', highlight: { background: '#232b42', border: '#818cf8' } }
  if (['cisco', 'netgear', 'tp-link', 'ubiquiti', 'asus', 'linksys'].some(v => d.vendor.toLowerCase().includes(v))) {
    return { background: '#1e2820', border: '#f59e0b', highlight: { background: '#252f26', border: '#fbbf24' } }
  }
  if (d.vendor.toLowerCase().includes('raspberry')) {
    return { background: '#2a1a1e', border: '#ef4444', highlight: { background: '#321e22', border: '#f87171' } }
  }
  return { background: '#161b22', border: '#3b82f6', highlight: { background: '#1c2230', border: '#60a5fa' } }
}

function deviceIcon(d: Device): string {
  const v = d.vendor.toLowerCase()
  const ports = d.open_ports ?? []
  if (v.includes('apple')) return '🍎'
  if (v.includes('samsung')) return '📱'
  if (v.includes('google')) return '🔷'
  if (v.includes('amazon')) return '📦'
  if (v.includes('raspberry')) return '🫐'
  if (['cisco', 'netgear', 'tp-link', 'ubiquiti'].some(x => v.includes(x))) return '🔀'
  if (ports.includes(3389)) return '🖥️'
  if (ports.includes(22)) return '🐧'
  if (ports.includes(80) || ports.includes(443)) return '🌐'
  if (!d.is_alive) return '💀'
  return '💻'
}

const NETWORK_OPTIONS: Options = {
  nodes: {
    shape: 'box',
    font: {
      color: '#e2e8f0',
      size: 11,
      face: 'JetBrains Mono, monospace',
      multi: true,
    },
    borderWidth: 1.5,
    borderWidthSelected: 2.5,
    shadow: { enabled: true, color: 'rgba(59,130,246,0.2)', size: 8, x: 0, y: 2 },
    margin: { top: 8, right: 10, bottom: 8, left: 10 },
  },
  edges: {
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.15 },
    width: 1,
    selectionWidth: 2,
    arrows: { to: { enabled: true, scaleFactor: 0.4 } },
  },
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -60,
      centralGravity: 0.005,
      springLength: 180,
      springConstant: 0.06,
      damping: 0.5,
      avoidOverlap: 0.6,
    },
    stabilization: { iterations: 150, updateInterval: 25 },
  },
  interaction: {
    hover: true,
    tooltipDelay: 200,
    navigationButtons: false,
    keyboard: false,
  },
  layout: { randomSeed: 42 },
}

export default function TopologyMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const nodesRef = useRef(new DataSet<any>([]))
  const edgesRef = useRef(new DataSet<any>([]))
  const edgeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const initialFitDoneRef = useRef(false)

  const devices = useNetworkStore(s => s.devices)
  const connections = useNetworkStore(s => s.connections)
  const selectDevice = useNetworkStore(s => s.selectDevice)
  const selectedIp = useNetworkStore(s => s.selectedIp)

  // Initialise network once
  useEffect(() => {
    if (!containerRef.current) return

    const network = new Network(
      containerRef.current,
      { nodes: nodesRef.current, edges: edgesRef.current },
      NETWORK_OPTIONS,
    )

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        selectDevice(params.nodes[0] as string)
      } else {
        selectDevice(null)
      }
    })

    networkRef.current = network

    return () => {
      network.destroy()
      networkRef.current = null
    }
  }, [])

  // Sync devices → nodes
  useEffect(() => {
    const nodes = nodesRef.current
    const existing = new Set(nodes.getIds() as string[])
    const incoming = new Set(devices.map(d => d.ip))

    // Remove stale nodes
    for (const id of existing) {
      if (!incoming.has(id)) nodes.remove(id)
    }

    // Upsert nodes — new nodes get spread around a circle so physics starts from
    // a reasonable position instead of a collapsed origin cluster.
    const newDevices = devices.filter(d => !existing.has(d.ip))
    const newCount = newDevices.length
    let newIdx = 0

    for (const d of devices) {
      const nodeData = {
        id: d.ip,
        label: `${deviceIcon(d)} ${deviceLabel(d)}`,
        color: deviceColor(d),
        opacity: d.is_alive ? 1 : 0.4,
        title: `<div style="font-family:monospace;font-size:12px;color:#e2e8f0;background:#161b22;padding:8px;border-radius:6px;border:1px solid #2d3748">
          <b>${d.ip}</b><br/>
          MAC: ${d.mac}<br/>
          Vendor: ${d.vendor}<br/>
          ${d.hostname ? `Host: ${d.hostname}<br/>` : ''}
          ${d.os_guess ? `OS: ${d.os_guess}<br/>` : ''}
          ${d.open_ports?.length ? `Ports: ${d.open_ports.slice(0, 8).join(', ')}<br/>` : ''}
          Status: ${d.is_alive ? '🟢 Alive' : '🔴 Offline'}
        </div>`,
      }
      if (existing.has(d.ip)) {
        nodes.update(nodeData)
      } else {
        const angle = (newIdx / Math.max(newCount, 1)) * 2 * Math.PI
        const radius = 220 + (newIdx % 3) * 60
        nodes.add({ ...nodeData, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
        newIdx++
      }
    }

    // After the first batch of devices loads, fit the viewport once the physics
    // simulation settles so all nodes are visible without manual zoom/pan.
    if (newDevices.length > 0 && networkRef.current && !initialFitDoneRef.current) {
      initialFitDoneRef.current = true
      const net = networkRef.current
      net.once('stabilized', () => {
        net.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
      })
    }
  }, [devices])

  // Flash traffic edges from recent connections
  useEffect(() => {
    if (!devices.length || !connections.length) return

    const deviceIps = new Set(devices.map(d => d.ip))
    // Take the most recent 15 connections
    const recent = connections.slice(0, 15)

    for (const conn of recent) {
      if (!deviceIps.has(conn.src_ip) || !deviceIps.has(conn.dst_ip)) continue
      if (conn.src_ip === conn.dst_ip) continue

      const edgeId = `${conn.src_ip}→${conn.dst_ip}:${conn.protocol}`
      const color = getProtoColor(conn.protocol)

      // Clear existing fade timer
      const existingTimer = edgeTimers.current.get(edgeId)
      if (existingTimer) clearTimeout(existingTimer)

      const edgeData = {
        id: edgeId,
        from: conn.src_ip,
        to: conn.dst_ip,
        color: { color, opacity: 0.9, highlight: color },
        width: Math.min(1 + conn.bytes / 5000, 4),
        label: conn.protocol,
        font: { color, size: 9, face: 'monospace', align: 'middle' },
        title: `${conn.protocol} | ${conn.bytes}B | ${conn.src_port ?? '?'} → ${conn.dst_port ?? '?'}`,
        dashes: false,
      }

      const edges = edgesRef.current
      if (edges.get(edgeId)) {
        edges.update(edgeData)
      } else {
        edges.add(edgeData)
      }

      // Fade out edge after 4 seconds
      const timer = setTimeout(() => {
        try {
          edges.update({ id: edgeId, color: { color, opacity: 0.15 }, width: 0.5 })
        } catch {
          // edge may have been removed
        }
      }, 4000)
      edgeTimers.current.set(edgeId, timer)
    }
  }, [connections])

  // Highlight selected node
  useEffect(() => {
    if (!networkRef.current) return
    if (selectedIp) {
      networkRef.current.selectNodes([selectedIp])
    } else {
      networkRef.current.unselectAll()
    }
  }, [selectedIp])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 pointer-events-none">
        {Object.entries(PROTO_COLORS).slice(0, 6).map(([proto, color]) => (
          <span
            key={proto}
            className="flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
          >
            <span className="w-2 h-0.5 inline-block rounded" style={{ background: color }} />
            {proto}
          </span>
        ))}
      </div>

      {/* Empty state */}
      {devices.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted pointer-events-none">
          <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <div className="text-sm">Scanning network for devices...</div>
          <div className="text-xs opacity-60">ARP sweep in progress</div>
        </div>
      )}
    </div>
  )
}
