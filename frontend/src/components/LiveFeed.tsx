import { useEffect, useRef } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { Connection } from '../types'

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

function getColor(proto: string): string {
  return PROTO_COLORS[proto] ?? PROTO_COLORS.Other
}

function formatBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}M`
  if (b >= 1_000) return `${(b / 1_000).toFixed(0)}K`
  return `${b}B`
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function ConnectionRow({ conn }: { conn: Connection }) {
  const color = getColor(conn.protocol)
  const portStr = conn.dst_port ? `:${conn.dst_port}` : ''

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-border/40 hover:bg-surface-2 transition-colors text-xs font-mono animate-fade-in">
      {/* Protocol badge */}
      <span
        className="flex-shrink-0 px-1 rounded text-xs leading-4 mt-0.5"
        style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
      >
        {conn.protocol}
      </span>

      {/* Flow */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-slate-300">
          <span className="truncate">{conn.src_ip}</span>
          <span className="text-muted flex-shrink-0">→</span>
          <span className="truncate">{conn.dst_ip}{portStr}</span>
        </div>
        <div className="flex items-center gap-2 text-muted mt-0.5">
          <span>{formatTime(conn.ts)}</span>
          <span>·</span>
          <span>{formatBytes(conn.bytes)}</span>
          {conn.packets > 1 && <span>· {conn.packets}p</span>}
        </div>
      </div>
    </div>
  )
}

export default function LiveFeed() {
  const connections = useNetworkStore(s => s.connections)
  const selectedIp = useNetworkStore(s => s.selectedIp)
  const listRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const filtered = selectedIp
    ? connections.filter(c => c.src_ip === selectedIp || c.dst_ip === selectedIp)
    : connections

  // Auto-scroll to top on new data (newest first)
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [connections.length])

  const handleScroll = () => {
    if (!listRef.current) return
    autoScrollRef.current = listRef.current.scrollTop < 40
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">
          Live Feed
          {selectedIp && (
            <span className="ml-2 text-accent-glow font-mono normal-case tracking-normal text-xs">{selectedIp}</span>
          )}
        </span>
        <span className="badge-muted">{filtered.length}</span>
      </div>

      {/* Header row */}
      <div className="flex gap-2 px-3 py-1 border-b border-border text-xs text-muted font-mono bg-surface-1">
        <span className="w-10 flex-shrink-0">Proto</span>
        <span className="flex-1">Flow</span>
      </div>

      {/* Feed */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted text-xs">
            {selectedIp ? `No traffic for ${selectedIp}` : 'Waiting for packets...'}
          </div>
        ) : (
          filtered.map((conn, i) => (
            <ConnectionRow key={`${conn.ts}-${conn.src_ip}-${conn.dst_ip}-${i}`} conn={conn} />
          ))
        )}
      </div>

      {/* Pause indicator */}
      {!autoScrollRef.current && (
        <div className="px-3 py-1 bg-surface-3 border-t border-border text-xs text-muted text-center">
          Scrolled — scroll to top to resume live feed
        </div>
      )}
    </div>
  )
}
