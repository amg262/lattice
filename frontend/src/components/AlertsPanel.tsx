import { useEffect, useRef } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { NetworkEvent } from '../types'

// ---------------------------------------------------------------------------
// Severity styles
// ---------------------------------------------------------------------------
const SEVERITY_STYLES: Record<string, { dot: string; label: string; bg: string; border: string }> = {
  info: {
    dot: 'bg-blue-400',
    label: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  warning: {
    dot: 'bg-yellow-400',
    label: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
  },
  danger: {
    dot: 'bg-red-400 animate-pulse',
    label: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
}

const EVENT_ICONS: Record<string, string> = {
  new_device: '📡',
  device_online: '🟢',
  suspicious_domain: '⚠️',
  traffic_spike: '📈',
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------
function EventRow({ event }: { event: NetworkEvent }) {
  const style = SEVERITY_STYLES[event.severity] ?? SEVERITY_STYLES.info
  const icon = EVENT_ICONS[event.event_type] ?? '🔔'

  return (
    <div
      className={`px-3 py-2.5 border-b border-border/50 hover:bg-surface-2 transition-colors ${style.bg}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base flex-shrink-0 leading-5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-mono font-semibold ${style.label} mb-0.5`}>
            {event.event_type.replace(/_/g, ' ').toUpperCase()}
          </div>
          <div className="text-xs text-slate-300 leading-relaxed">{event.message}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted font-mono">
            {event.device_ip && <span>{event.device_ip}</span>}
            {event.device_ip && <span>·</span>}
            <span title={formatTime(event.ts)}>{timeAgo(event.ts)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alert badge (used in header)
// ---------------------------------------------------------------------------
export function AlertBadge({
  onClick,
  unread,
}: {
  onClick: () => void
  unread: number
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono text-muted hover:text-slate-300 hover:bg-surface-2 transition-colors"
      title="Network alerts"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-xs font-bold text-white bg-red-500 rounded-full px-1 animate-pulse">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Alerts panel dropdown
// ---------------------------------------------------------------------------
export default function AlertsPanel({ onClose }: { onClose: () => void }) {
  const events = useNetworkStore(s => s.events)
  const markAlertsViewed = useNetworkStore(s => s.markAlertsViewed)
  const panelRef = useRef<HTMLDivElement>(null)

  // Mark as viewed when panel opens
  useEffect(() => {
    markAlertsViewed()
  }, [])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const countBySeverity = events.reduce(
    (acc, e) => { acc[e.severity] = (acc[e.severity] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  return (
    <div
      ref={panelRef}
      className="absolute right-4 top-14 z-50 w-96 max-h-[70vh] flex flex-col rounded-lg border border-border bg-surface-1 shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200 font-mono tracking-wide">
            NETWORK ALERTS
          </span>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            {countBySeverity.danger > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                {countBySeverity.danger} critical
              </span>
            )}
            {countBySeverity.warning > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                {countBySeverity.warning} warn
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close alerts"
          className="text-muted hover:text-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted text-xs space-y-2">
            <div className="text-3xl opacity-20">🔔</div>
            <div>No alerts yet</div>
            <div className="opacity-60">Events will appear here as they're detected</div>
          </div>
        ) : (
          events.map((evt, i) => (
            <EventRow key={`${evt.ts}-${evt.event_type}-${i}`} event={evt} />
          ))
        )}
      </div>

      {events.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-surface text-xs text-muted text-center flex-shrink-0">
          {events.length} event{events.length !== 1 ? 's' : ''} · showing most recent first
        </div>
      )}
    </div>
  )
}
