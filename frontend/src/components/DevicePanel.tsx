import { useEffect, useState } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { Device, ActivityEntry, UsagePoint } from '../types'

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1_024) return `${(b / 1_024).toFixed(0)} KB`
  return `${b} B`
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------------------
// Activity timeline entry
// ---------------------------------------------------------------------------
const ACTIVITY_COLORS: Record<string, string> = {
  DNS: '#f59e0b',
  SNI: '#22c55e',
  HTTP: '#3b82f6',
  TLS: '#22c55e',
  SSH: '#a78bfa',
  TCP: '#60a5fa',
  UDP: '#34d399',
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const color = ACTIVITY_COLORS[entry.proto] ?? '#94a3b8'
  const isConn = entry.kind === 'conn'
  return (
    <div className="flex items-start gap-2 py-1 border-b border-border/30 text-xs font-mono">
      <span
        className="flex-shrink-0 px-1 rounded leading-4 mt-0.5"
        style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}
      >
        {entry.proto}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-slate-300 truncate" title={entry.detail}>
          {isConn ? `→ ${entry.detail}` : entry.detail}
        </div>
        <div className="text-muted">{formatTime(entry.ts)}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expanded device detail
// ---------------------------------------------------------------------------
function DeviceDetail({ device }: { device: Device }) {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [usage, setUsage] = useState<UsagePoint | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'activity'>('info')

  useEffect(() => {
    // Fetch today's usage
    fetch(`/api/traffic/usage?ip=${device.ip}&period=day`)
      .then(r => r.json())
      .then((rows: UsagePoint[]) => {
        if (rows.length > 0) {
          const totals = rows.reduce(
            (acc, r) => ({ bytes_out: acc.bytes_out + r.bytes_out, bytes_in: acc.bytes_in + r.bytes_in }),
            { bytes_out: 0, bytes_in: 0 }
          )
          setUsage(totals)
        }
      })
      .catch(() => {})
  }, [device.ip])

  useEffect(() => {
    if (activeTab !== 'activity') return
    fetch(`/api/devices/${device.ip}/activity?hours=24&limit=50`)
      .then(r => r.json())
      .then(setActivity)
      .catch(() => {})
  }, [device.ip, activeTab])

  return (
    <div className="mt-2 border-t border-border pt-2">
      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        {(['info', 'activity'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs font-mono px-2 py-0.5 rounded transition-colors ${
              activeTab === tab
                ? 'bg-accent/20 text-accent'
                : 'text-muted hover:text-slate-300'
            }`}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === 'info' && (
        <div className="space-y-1">
          <DetailRow label="MAC" value={device.mac} />
          <DetailRow label="Vendor" value={device.vendor || '—'} />
          {device.hostname && <DetailRow label="Host" value={device.hostname} />}
          {device.os_guess && <DetailRow label="OS" value={device.os_guess} />}
          {device.open_ports.length > 0 && (
            <div>
              <span className="text-muted text-xs">Ports: </span>
              <span className="font-mono text-xs text-slate-300">
                {device.open_ports.slice(0, 10).join(', ')}
                {device.open_ports.length > 10 && ` +${device.open_ports.length - 10}`}
              </span>
            </div>
          )}
          <DetailRow label="Last seen" value={timeAgo(device.last_seen)} />
          <DetailRow label="First seen" value={timeAgo(device.first_seen)} />
          {usage && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-xs text-muted mb-1">Today's usage</div>
              <div className="flex gap-3 text-xs font-mono">
                <span>
                  <span className="text-muted">↑ </span>
                  <span className="text-slate-300">{formatBytes(usage.bytes_out)}</span>
                </span>
                <span>
                  <span className="text-muted">↓ </span>
                  <span className="text-slate-300">{formatBytes(usage.bytes_in)}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-0 max-h-48 overflow-y-auto">
          {activity.length === 0 ? (
            <div className="text-xs text-muted text-center py-4">No activity in last 24h</div>
          ) : (
            activity.map((e, i) => <ActivityRow key={`${e.ts}-${e.detail}-${i}`} entry={e} />)
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1 text-xs">
      <span className="text-muted w-16 flex-shrink-0">{label}:</span>
      <span className="font-mono text-slate-300 truncate">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Device row
// ---------------------------------------------------------------------------
function DeviceRow({ device, selected, onSelect, dnsCount }: {
  device: Device
  selected: boolean
  onSelect: () => void
  dnsCount: number
}) {
  const name = device.hostname || device.vendor || device.ip
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 transition-colors rounded-sm group ${
        selected
          ? 'bg-accent/20 border-l-2 border-accent'
          : 'border-l-2 border-transparent hover:bg-surface-2 hover:border-surface-4'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={device.is_alive ? 'dot-live' : 'dot-dead'} />
        <span className="flex-1 min-w-0 text-xs font-mono text-slate-200 truncate">{name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {dnsCount > 0 && (
            <span className="text-xs font-mono px-1 rounded"
              style={{ background: '#f59e0b18', color: '#f59e0b', border: '1px solid #f59e0b30' }}>
              {dnsCount}
            </span>
          )}
          {device.open_ports.length > 0 && (
            <span className="text-xs text-muted font-mono">
              {device.open_ports.length}p
            </span>
          )}
        </div>
      </div>
      <div className="ml-4 text-xs font-mono text-muted truncate">{device.ip}</div>
      {selected && <DeviceDetail device={device} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main DevicePanel
// ---------------------------------------------------------------------------
export default function DevicePanel() {
  const devices = useNetworkStore(s => s.devices)
  const dnsLog = useNetworkStore(s => s.dnsLog)
  const selectedIp = useNetworkStore(s => s.selectedIp)
  const selectDevice = useNetworkStore(s => s.selectDevice)
  const [filter, setFilter] = useState('')

  // Compute DNS counts per IP from in-memory log
  const dnsCounts = dnsLog.reduce((acc, e) => {
    acc[e.src_ip] = (acc[e.src_ip] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const alive = devices.filter(d => d.is_alive)
  const offline = devices.filter(d => !d.is_alive)

  const filterFn = (d: Device) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      d.ip.includes(q) ||
      d.mac.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.hostname.toLowerCase().includes(q)
    )
  }

  const filteredAlive = alive.filter(filterFn)
  const filteredOffline = offline.filter(filterFn)

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Devices</span>
        <div className="flex gap-2 items-center">
          <span className="badge-green">{alive.length} live</span>
          {offline.length > 0 && <span className="badge-muted">{offline.length} offline</span>}
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter devices..."
          className="w-full bg-surface text-xs font-mono text-slate-300 placeholder-muted px-2 py-1 rounded border border-border focus:outline-none focus:border-accent/60 transition-colors"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {devices.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted text-xs">
            <div className="mb-2">Scanning network...</div>
            <div className="opacity-60">ARP sweep in progress</div>
          </div>
        ) : (
          <>
            {filteredAlive.map(d => (
              <DeviceRow
                key={d.ip}
                device={d}
                selected={selectedIp === d.ip}
                onSelect={() => selectDevice(selectedIp === d.ip ? null : d.ip)}
                dnsCount={dnsCounts[d.ip] ?? 0}
              />
            ))}
            {filteredOffline.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-muted uppercase tracking-wider border-t border-border mt-1">
                  Offline
                </div>
                {filteredOffline.map(d => (
                  <DeviceRow
                    key={d.ip}
                    device={d}
                    selected={selectedIp === d.ip}
                    onSelect={() => selectDevice(selectedIp === d.ip ? null : d.ip)}
                    dnsCount={dnsCounts[d.ip] ?? 0}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
