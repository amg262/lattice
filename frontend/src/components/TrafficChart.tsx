import { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useNetworkStore } from '../stores/networkStore'

type Window = '1h' | '6h' | '24h'

interface ChartPoint {
  ts: string
  label: string
  bytes_out: number
  bytes_in: number
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}KB`
  return `${bytes}B`
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function hourLabel(w: Window): number {
  return w === '1h' ? 1 : w === '6h' ? 6 : 24
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-2 border border-border rounded px-3 py-2 text-xs font-mono shadow-lg">
      <div className="text-muted mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatBytes(p.value)}
        </div>
      ))}
    </div>
  )
}

export default function TrafficChart() {
  const [window, setWindow] = useState<Window>('1h')
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(false)
  const selectedIp = useNetworkStore(s => s.selectedIp)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ hours: String(hourLabel(window)) })
      if (selectedIp) params.set('ip', selectedIp)
      const res = await fetch(`/api/traffic/history?${params}`)
      const raw: { ts: string; ip: string; bytes_out: number; bytes_in: number }[] = await res.json()

      const points: ChartPoint[] = raw.map(r => ({
        ts: r.ts,
        label: formatTime(r.ts),
        bytes_out: r.bytes_out,
        bytes_in: r.bytes_in,
      }))
      setData(points)
    } catch {
      // backend may not be ready yet
    } finally {
      setLoading(false)
    }
  }, [window, selectedIp])

  useEffect(() => {
    fetchHistory()
    const id = setInterval(fetchHistory, 30_000)
    return () => clearInterval(id)
  }, [fetchHistory])

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">
          Bandwidth
          {selectedIp && <span className="ml-2 text-accent-glow font-mono normal-case tracking-normal">{selectedIp}</span>}
        </span>
        <div className="flex gap-1">
          {(['1h', '6h', '24h'] as Window[]).map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                window === w
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-slate-300 hover:bg-surface-3'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2">
        {loading && data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted text-xs">Loading...</div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted text-xs">
            No traffic data yet — collecting...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#2d3748" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#64748b', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={formatBytes}
                tick={{ fill: '#64748b', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={6}
                wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }}
              />
              <Area
                type="monotone"
                dataKey="bytes_out"
                name="Out"
                stroke="#3b82f6"
                fill="url(#gradOut)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#3b82f6' }}
              />
              <Area
                type="monotone"
                dataKey="bytes_in"
                name="In"
                stroke="#22c55e"
                fill="url(#gradIn)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#22c55e' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
