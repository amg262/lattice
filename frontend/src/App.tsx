import { useEffect, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useNetworkStore } from './stores/networkStore'
import TopologyMap from './components/TopologyMap'
import DevicePanel from './components/DevicePanel'
import LiveFeed from './components/LiveFeed'
import TrafficChart from './components/TrafficChart'
import ProtocolPie from './components/ProtocolPie'
import TopTalkers from './components/TopTalkers'
import WorldMap from './components/WorldMap'
import GeoFeed from './components/GeoFeed'
import SpyLog from './components/SpyLog'
import AlertsPanel, { AlertBadge } from './components/AlertsPanel'

type View = 'topology' | 'map' | 'spy'

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse-slow' : 'bg-danger'}`} />
      <span className={`text-xs font-mono ${connected ? 'text-success' : 'text-danger'}`}>
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </span>
  )
}

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const buttons: { id: View; label: string; icon: React.ReactNode }[] = [
    {
      id: 'topology',
      label: 'LAN',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
        </svg>
      ),
    },
    {
      id: 'map',
      label: 'WORLD MAP',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253" />
        </svg>
      ),
    },
    {
      id: 'spy',
      label: 'SPY LOG',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 border border-border">
      {buttons.map(({ id, label, icon }) => (
        <button
          key={id}
          onClick={() => setView(id)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
            view === id
              ? 'bg-surface-3 text-slate-200 shadow-sm'
              : 'text-muted hover:text-slate-300'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unread alert count — events newer than alertsLastViewed
// ---------------------------------------------------------------------------
function useUnreadAlerts(): number {
  const events = useNetworkStore(s => s.events)
  const alertsLastViewed = useNetworkStore(s => s.alertsLastViewed)
  if (!alertsLastViewed) return events.length
  const cutoff = new Date(alertsLastViewed)
  return events.filter(e => new Date(e.ts) > cutoff).length
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const wsConnected = useNetworkStore(s => s.wsConnected)
  const stats = useNetworkStore(s => s.stats)
  const lastUpdate = useNetworkStore(s => s.lastUpdate)
  const geoFlows = useNetworkStore(s => s.geoFlows)
  const dnsLog = useNetworkStore(s => s.dnsLog)
  const [config, setConfig] = useState<{ interface: string; subnet: string } | null>(null)
  const [showAlerts, setShowAlerts] = useState(false)
  const unreadAlerts = useUnreadAlerts()

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setConfig({ interface: d.interface, subnet: d.subnet }))
      .catch(() => {})
  }, [])

  const formatTs = (ts: string | null) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleTimeString()
  }

  return (
    <header className="flex items-center h-12 px-4 border-b border-border bg-surface-1 flex-shrink-0 gap-4 relative">
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <span className="text-sm font-semibold tracking-widest uppercase text-slate-200">Lattice</span>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Network info */}
      {config && (
        <div className="flex items-center gap-4 text-xs font-mono text-muted">
          <span className="flex items-center gap-1">
            <span className="text-surface-4">iface</span>
            <span className="text-slate-400">{config.interface}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-surface-4">subnet</span>
            <span className="text-slate-400">{config.subnet}</span>
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs font-mono text-muted">
        <span className="flex items-center gap-1">
          <span className="text-accent-glow font-semibold">{stats.alive_devices}</span>
          <span>/ {stats.total_devices} devices</span>
        </span>
        {stats.top_protocol !== '—' && (
          <span className="flex items-center gap-1">
            <span className="text-surface-4">top</span>
            <span className="text-warning">{stats.top_protocol}</span>
          </span>
        )}
        {view === 'map' && geoFlows.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-surface-4">ext</span>
            <span className="text-success">{new Set(geoFlows.map(f => f.remote_ip)).size} IPs</span>
          </span>
        )}
        {view === 'spy' && dnsLog.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-surface-4">queries</span>
            <span style={{ color: '#f59e0b' }}>{dnsLog.length}</span>
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* View Toggle */}
      <ViewToggle view={view} setView={setView} />

      <div className="flex-1" />

      {/* Last update */}
      {lastUpdate && (
        <span className="text-xs font-mono text-muted hidden lg:block">{formatTs(lastUpdate)}</span>
      )}

      <div className="h-4 w-px bg-border" />

      {/* Alert badge */}
      <AlertBadge
        unread={unreadAlerts}
        onClick={() => setShowAlerts(v => !v)}
      />

      <div className="h-4 w-px bg-border" />

      <StatusDot connected={wsConnected} />

      {/* Alerts dropdown panel */}
      {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} />}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Topology layout
// ---------------------------------------------------------------------------
function TopologyView() {
  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-56 flex-shrink-0 border-r border-border panel bg-surface-1 rounded-none flex flex-col">
        <DevicePanel />
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 panel rounded-none border-0 border-b border-border bg-surface relative">
          <div className="panel-header absolute top-0 left-0 right-0 z-10 bg-surface/80 backdrop-blur-sm">
            <span className="panel-title">Network Topology</span>
            <span className="text-xs text-muted font-mono">force-directed · click device to filter</span>
          </div>
          <div className="w-full h-full pt-9">
            <TopologyMap />
          </div>
        </div>

        <div className="h-48 flex-shrink-0 flex border-t border-border">
          <div className="flex-1 min-w-0 panel rounded-none border-0 border-r border-border flex flex-col">
            <TrafficChart />
          </div>
          <div className="w-64 flex-shrink-0 panel rounded-none border-0 border-r border-border flex flex-col">
            <ProtocolPie />
          </div>
          <div className="w-72 flex-shrink-0 panel rounded-none border-0 flex flex-col">
            <TopTalkers />
          </div>
        </div>
      </main>

      <aside className="w-72 flex-shrink-0 border-l border-border panel bg-surface-1 rounded-none flex flex-col">
        <LiveFeed />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// World Map layout
// ---------------------------------------------------------------------------
function MapView() {
  return (
    <div className="flex flex-1 min-h-0">
      <main className="flex-1 min-w-0 relative bg-surface">
        <WorldMap />
      </main>
      <aside className="w-80 flex-shrink-0 border-l border-border panel bg-surface-1 rounded-none flex flex-col">
        <GeoFeed />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spy Log layout
// ---------------------------------------------------------------------------
function SpyView() {
  return <SpyLog />
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function App() {
  useWebSocket()
  const [view, setView] = useState<View>('topology')

  // All three views stay permanently mounted so deck.gl never destroys its
  // WebGL context mid-flight (which causes the luma.gl ResizeObserver error
  // "Cannot read properties of undefined (reading 'maxTextureDimension2D')").
  // Inactive views are hidden via CSS — context stays alive, no cleanup race.
  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      <Header view={view} setView={setView} />
      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 flex ${view === 'topology' ? 'z-10' : 'opacity-0 pointer-events-none z-0'}`}>
          <TopologyView />
        </div>
        <div className={`absolute inset-0 flex ${view === 'map' ? 'z-10' : 'opacity-0 pointer-events-none z-0'}`}>
          <MapView />
        </div>
        <div className={`absolute inset-0 flex ${view === 'spy' ? 'z-10' : 'opacity-0 pointer-events-none z-0'}`}>
          <SpyView />
        </div>
      </div>
    </div>
  )
}
