import { useState } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { Device } from '../types'

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function DeviceRow({ device, selected, onSelect }: {
  device: Device
  selected: boolean
  onSelect: () => void
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
        {device.open_ports.length > 0 && (
          <span className="flex-shrink-0 text-xs text-muted font-mono">
            {device.open_ports.length}p
          </span>
        )}
      </div>
      <div className="ml-4 text-xs font-mono text-muted truncate">{device.ip}</div>
      {selected && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
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
        </div>
      )}
    </button>
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

export default function DevicePanel() {
  const devices = useNetworkStore(s => s.devices)
  const selectedIp = useNetworkStore(s => s.selectedIp)
  const selectDevice = useNetworkStore(s => s.selectDevice)
  const [filter, setFilter] = useState('')

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
