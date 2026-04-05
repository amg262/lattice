import { useRef, useEffect } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { GeoFlow } from '../types'

const PROTO_COLORS: Record<string, string> = {
  TLS:   '#22c55e',
  DNS:   '#f59e0b',
  HTTP:  '#3b82f6',
  SSH:   '#a78bfa',
  ICMP:  '#94a3b8',
  ARP:   '#64748b',
  TCP:   '#60a5fa',
  UDP:   '#34d399',
  DHCP:  '#fb923c',
  NTP:   '#c084fc',
  Other: '#475569',
}

function getColor(proto: string): string {
  return PROTO_COLORS[proto] ?? PROTO_COLORS.Other
}

function countryFlag(cc: string): string {
  if (!cc || cc.length !== 2) return '🌐'
  try {
    const codePoints = cc.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    return String.fromCodePoint(...codePoints)
  } catch {
    return '🌐'
  }
}

function formatBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`
  if (b >= 1_000) return `${(b / 1_000).toFixed(0)}KB`
  return `${b}B`
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 5) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function GeoFlowRow({ flow }: { flow: GeoFlow }) {
  const color = getColor(flow.protocol)
  const flag = countryFlag(flow.country_code)
  const location = [flow.city, flow.country].filter(Boolean).join(', ') || flow.remote_ip

  return (
    <div className="px-3 py-2 border-b border-border/40 hover:bg-surface-2 transition-colors animate-fade-in">
      <div className="flex items-start gap-2">
        {/* Flag */}
        <span className="text-base leading-none mt-0.5 flex-shrink-0">{flag}</span>

        <div className="flex-1 min-w-0">
          {/* Location + protocol */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs text-slate-200 font-medium truncate flex-1">{location}</span>
            <span
              className="flex-shrink-0 text-xs px-1 rounded font-mono leading-4"
              style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
            >
              {flow.protocol}
            </span>
          </div>

          {/* ISP / org */}
          {(flow.isp || flow.org) && (
            <div className="text-xs text-muted truncate mb-0.5">
              {flow.isp || flow.org}
            </div>
          )}

          {/* IP + meta */}
          <div className="flex items-center gap-2 text-xs font-mono text-muted">
            <span>{flow.remote_ip}</span>
            <span>·</span>
            <span style={{ color }}>{formatBytes(flow.bytes)}</span>
            {flow.dst_port && (
              <>
                <span>·</span>
                <span>:{flow.dst_port}</span>
              </>
            )}
            <span className="ml-auto flex-shrink-0">{timeAgo(flow.ts)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Country summary section
function CountrySummary({ flows }: { flows: GeoFlow[] }) {
  const byCountry = new Map<string, { cc: string; count: number; bytes: number }>()
  for (const f of flows) {
    const key = f.country || f.remote_ip
    const existing = byCountry.get(key)
    if (existing) {
      existing.count++
      existing.bytes += f.bytes
    } else {
      byCountry.set(key, { cc: f.country_code, count: 1, bytes: f.bytes })
    }
  }

  const sorted = Array.from(byCountry.entries())
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 8)

  if (sorted.length === 0) return null

  return (
    <div className="border-b border-border">
      <div className="px-3 py-1.5 text-xs text-muted uppercase tracking-wider font-semibold bg-surface-1/60">
        Top Destinations
      </div>
      <div className="px-3 py-1.5 space-y-1">
        {sorted.map(([country, data]) => (
          <div key={country} className="flex items-center gap-2 text-xs">
            <span className="text-sm leading-none">{countryFlag(data.cc)}</span>
            <span className="flex-1 text-slate-300 truncate">{country}</span>
            <span className="font-mono text-muted">{data.count}×</span>
            <span className="font-mono text-accent-glow">{formatBytes(data.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function GeoFeed() {
  const geoFlows = useNetworkStore(s => s.geoFlows)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to top on new flows
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [geoFlows.length])

  const uniqueCountries = new Set(geoFlows.map(f => f.country)).size
  const totalBytes = geoFlows.reduce((s, f) => s + f.bytes, 0)

  function formatBytes2(b: number): string {
    if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)}GB`
    if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`
    if (b >= 1_000) return `${(b / 1_000).toFixed(0)}KB`
    return `${b}B`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">Geo Feed</span>
        <div className="flex gap-2 items-center">
          {uniqueCountries > 0 && (
            <span className="badge-blue">{uniqueCountries} countries</span>
          )}
          <span className="badge-muted">{geoFlows.length}</span>
        </div>
      </div>

      {/* Summary stats */}
      {geoFlows.length > 0 && (
        <div className="grid grid-cols-2 gap-0 border-b border-border">
          <div className="px-3 py-2 border-r border-border">
            <div className="text-xs text-muted">Destinations</div>
            <div className="text-sm font-mono text-accent-glow font-semibold">
              {new Set(geoFlows.map(f => f.remote_ip)).size}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-xs text-muted">Total data</div>
            <div className="text-sm font-mono text-success font-semibold">{formatBytes2(totalBytes)}</div>
          </div>
        </div>
      )}

      {/* Country summary */}
      <CountrySummary flows={geoFlows} />

      {/* Header row */}
      <div className="px-3 py-1 border-b border-border text-xs text-muted font-mono bg-surface-1 flex-shrink-0">
        Live connections · newest first
      </div>

      {/* Flow list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {geoFlows.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted text-xs space-y-2">
            <div className="text-2xl">🌐</div>
            <div>Waiting for external traffic</div>
            <div className="opacity-60 text-xs">IPs are resolved as they appear in the packet capture. This may take a few seconds.</div>
          </div>
        ) : (
          geoFlows.map((flow, i) => (
            <GeoFlowRow key={`${flow.ts}-${flow.remote_ip}-${i}`} flow={flow} />
          ))
        )}
      </div>
    </div>
  )
}
