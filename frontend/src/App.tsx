import { useEffect, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useNetworkStore } from './stores/networkStore'
import TopologyMap from './components/TopologyMap'
import DevicePanel from './components/DevicePanel'
import LiveFeed from './components/LiveFeed'
import TrafficChart from './components/TrafficChart'
import ProtocolPie from './components/ProtocolPie'
import TopTalkers from './components/TopTalkers'

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse-slow' : 'bg-danger'}`}
      />
      <span className={`text-xs font-mono ${connected ? 'text-success' : 'text-danger'}`}>
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </span>
  )
}

function Header() {
  const wsConnected = useNetworkStore(s => s.wsConnected)
  const stats = useNetworkStore(s => s.stats)
  const lastUpdate = useNetworkStore(s => s.lastUpdate)
  const [config, setConfig] = useState<{ interface: string; subnet: string } | null>(null)

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
    <header className="flex items-center h-12 px-4 border-b border-border bg-surface-1 flex-shrink-0 gap-6">
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
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Last update */}
      {lastUpdate && (
        <span className="text-xs font-mono text-muted hidden md:block">
          {formatTs(lastUpdate)}
        </span>
      )}

      <div className="h-4 w-px bg-border" />

      <StatusDot connected={wsConnected} />
    </header>
  )
}

export default function App() {
  useWebSocket()

  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      <Header />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 gap-0">

        {/* Left sidebar — Devices */}
        <aside className="w-56 flex-shrink-0 border-r border-border panel bg-surface-1 rounded-none flex flex-col">
          <DevicePanel />
        </aside>

        {/* Center — Topology + Bottom strip */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Topology graph */}
          <div className="flex-1 min-h-0 panel rounded-none border-0 border-b border-border bg-surface relative">
            <div className="panel-header absolute top-0 left-0 right-0 z-10 bg-surface/80 backdrop-blur-sm">
              <span className="panel-title">Network Topology</span>
              <span className="text-xs text-muted font-mono">force-directed · click device to filter</span>
            </div>
            <div className="w-full h-full pt-9">
              <TopologyMap />
            </div>
          </div>

          {/* Bottom strip: Traffic + Protocol + Talkers */}
          <div className="h-48 flex-shrink-0 flex border-t border-border">
            {/* Bandwidth chart */}
            <div className="flex-1 min-w-0 panel rounded-none border-0 border-r border-border flex flex-col">
              <TrafficChart />
            </div>

            {/* Protocol donut */}
            <div className="w-64 flex-shrink-0 panel rounded-none border-0 border-r border-border flex flex-col">
              <ProtocolPie />
            </div>

            {/* Top Talkers */}
            <div className="w-72 flex-shrink-0 panel rounded-none border-0 flex flex-col">
              <TopTalkers />
            </div>
          </div>
        </main>

        {/* Right sidebar — Live Feed */}
        <aside className="w-72 flex-shrink-0 border-l border-border panel bg-surface-1 rounded-none flex flex-col">
          <LiveFeed />
        </aside>
      </div>
    </div>
  )
}
