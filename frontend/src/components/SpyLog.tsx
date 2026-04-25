import { useEffect, useRef, useState } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { DnsEntry, TopDomain } from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TYPE_COLORS: Record<string, string> = {
  DNS: '#f59e0b',
  SNI: '#22c55e',
  HTTP: '#3b82f6',
}

function typeColor(t: string) {
  return TYPE_COLORS[t] ?? '#94a3b8'
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------------------
// Per-device DNS query count derived from log
// ---------------------------------------------------------------------------
function useDnsCounts(dnsLog: DnsEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of dnsLog) {
    counts[e.src_ip] = (counts[e.src_ip] ?? 0) + 1
  }
  return counts
}

// ---------------------------------------------------------------------------
// Derive top domains from log for the selected IP (or all)
// ---------------------------------------------------------------------------
function computeTopDomains(dnsLog: DnsEntry[], ip: string | null): TopDomain[] {
  const filtered = ip ? dnsLog.filter(e => e.src_ip === ip) : dnsLog
  const counts: Record<string, { count: number; query_type: string }> = {}
  for (const e of filtered) {
    const key = e.domain
    if (!counts[key]) counts[key] = { count: 0, query_type: e.query_type }
    counts[key].count++
  }
  return Object.entries(counts)
    .map(([domain, { count, query_type }]) => ({ domain, query_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

// ---------------------------------------------------------------------------
// Spy entry row
// ---------------------------------------------------------------------------
function SpyRow({ entry }: { entry: DnsEntry }) {
  const color = typeColor(entry.query_type)
  const devices = useNetworkStore(s => s.devices)
  const device = devices.find(d => d.ip === entry.src_ip)
  const label = device?.hostname || device?.vendor || entry.src_ip

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-border/40 hover:bg-surface-2 transition-colors text-xs font-mono animate-fade-in">
      {/* Type badge */}
      <span
        className="flex-shrink-0 px-1.5 rounded text-xs leading-5 mt-0.5 font-semibold"
        style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
      >
        {entry.query_type}
      </span>

      {/* Domain */}
      <div className="flex-1 min-w-0">
        <div className="text-slate-200 truncate" title={entry.domain}>
          {entry.domain}
        </div>
        <div className="flex items-center gap-2 text-muted mt-0.5">
          <span className="text-slate-500 truncate">{label}</span>
          <span>·</span>
          <span>{formatTime(entry.ts)}</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Device selector panel (left)
// ---------------------------------------------------------------------------
function DeviceSelector({
  selectedIp,
  onSelect,
  counts,
}: {
  selectedIp: string | null
  onSelect: (ip: string | null) => void
  counts: Record<string, number>
}) {
  const devices = useNetworkStore(s => s.devices)
  const alive = devices.filter(d => d.is_alive)
  const offline = devices.filter(d => !d.is_alive)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const Row = ({ d }: { d: (typeof devices)[0] }) => {
    const name = d.hostname || d.vendor || d.ip
    const cnt = counts[d.ip] ?? 0
    const sel = selectedIp === d.ip
    return (
      <button
        onClick={() => onSelect(sel ? null : d.ip)}
        className={`w-full text-left px-3 py-2 transition-colors rounded-sm group ${
          sel
            ? 'bg-accent/20 border-l-2 border-accent'
            : 'border-l-2 border-transparent hover:bg-surface-2 hover:border-surface-4'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={d.is_alive ? 'dot-live' : 'dot-dead'} />
          <span className="flex-1 min-w-0 text-xs font-mono text-slate-200 truncate">{name}</span>
          {cnt > 0 && (
            <span className="flex-shrink-0 text-xs font-mono px-1 rounded"
              style={{ background: '#f59e0b20', color: '#f59e0b' }}>
              {cnt}
            </span>
          )}
        </div>
        <div className="ml-4 text-xs font-mono text-muted truncate">{d.ip}</div>
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Devices</span>
        <button
          onClick={() => onSelect(null)}
          className={`text-xs font-mono px-1.5 py-0.5 rounded transition-colors ${
            !selectedIp ? 'bg-accent/20 text-accent' : 'text-muted hover:text-slate-300'
          }`}
        >
          ALL {total > 0 && <span className="opacity-70">{total}</span>}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {alive.map(d => <Row key={d.ip} d={d} />)}
        {offline.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs text-muted uppercase tracking-wider border-t border-border mt-1">
              Offline
            </div>
            {offline.map(d => <Row key={d.ip} d={d} />)}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top domains bar chart (right panel)
// ---------------------------------------------------------------------------
function TopDomainsPanel({ topDomains }: { topDomains: TopDomain[] }) {
  const max = topDomains[0]?.count ?? 1

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Top Domains</span>
        <span className="badge-muted">{topDomains.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {topDomains.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted text-xs">No queries yet</div>
        ) : (
          topDomains.map((d, i) => {
            const color = typeColor(d.query_type)
            const pct = (d.count / max) * 100
            return (
              <div key={`${d.domain}-${i}`} className="text-xs font-mono">
                <div className="flex items-center gap-1 mb-0.5">
                  <span
                    className="flex-shrink-0 text-xs px-1 rounded leading-4"
                    style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
                  >
                    {d.query_type}
                  </span>
                  <span className="flex-1 text-slate-300 truncate" title={d.domain}>
                    {d.domain.length > 28 ? d.domain.slice(0, 27) + '…' : d.domain}
                  </span>
                  <span className="text-muted ml-1 flex-shrink-0">{d.count}</span>
                </div>
                <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main SpyLog view
// ---------------------------------------------------------------------------
export default function SpyLog() {
  const dnsLog = useNetworkStore(s => s.dnsLog)
  const [selectedIp, setSelectedIp] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const counts = useDnsCounts(dnsLog)
  const filtered = selectedIp ? dnsLog.filter(e => e.src_ip === selectedIp) : dnsLog
  const topDomains = computeTopDomains(dnsLog, selectedIp)

  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [dnsLog.length])

  const handleScroll = () => {
    if (!listRef.current) return
    autoScrollRef.current = listRef.current.scrollTop < 40
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left — Device Selector */}
      <aside className="w-56 flex-shrink-0 border-r border-border panel bg-surface-1 rounded-none flex flex-col">
        <DeviceSelector selectedIp={selectedIp} onSelect={setSelectedIp} counts={counts} />
      </aside>

      {/* Center — Spy Feed */}
      <main className="flex-1 min-w-0 flex flex-col bg-surface">
        <div className="panel-header border-b border-border bg-surface-1">
          <span className="panel-title">
            Spy Log
            {selectedIp && (
              <span className="ml-2 text-accent-glow font-mono normal-case tracking-normal text-xs">
                {selectedIp}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted font-mono">DNS · SNI · HTTP — live capture</span>
            <span className="badge-muted">{filtered.length}</span>
          </div>
        </div>

        {/* Column headers */}
        <div className="flex gap-2 px-3 py-1 border-b border-border text-xs text-muted font-mono bg-surface-1">
          <span className="w-12 flex-shrink-0">Type</span>
          <span className="flex-1">Domain / URL</span>
          <span className="w-32 flex-shrink-0 text-right">Device · Time</span>
        </div>

        {/* Feed */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted text-xs space-y-2">
              <div className="text-2xl opacity-20">🔍</div>
              <div>Watching for DNS queries, HTTPS connections, and HTTP requests...</div>
              <div className="opacity-60">Traffic will appear here as devices browse the web</div>
            </div>
          ) : (
            filtered.map((entry, i) => (
              <SpyRow key={`${entry.ts}-${entry.src_ip}-${entry.domain}-${i}`} entry={entry} />
            ))
          )}
        </div>

        {!autoScrollRef.current && (
          <div className="px-3 py-1 bg-surface-3 border-t border-border text-xs text-muted text-center">
            Scrolled — scroll to top to resume live feed
          </div>
        )}
      </main>

      {/* Right — Top Domains */}
      <aside className="w-72 flex-shrink-0 border-l border-border panel bg-surface-1 rounded-none flex flex-col">
        <TopDomainsPanel topDomains={topDomains} />
      </aside>
    </div>
  )
}
