import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useNetworkStore } from '../stores/networkStore'

const COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444',
  '#34d399', '#fb923c', '#c084fc', '#60a5fa', '#94a3b8',
]

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const { protocol, count, pct } = payload[0].payload
  return (
    <div className="bg-surface-2 border border-border rounded px-3 py-2 text-xs font-mono shadow-lg">
      <div className="text-slate-200 font-semibold">{protocol}</div>
      <div className="text-muted">{count.toLocaleString()} pkts · {pct}%</div>
    </div>
  )
}

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, pct }: any) => {
  if (pct < 5) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontFamily="monospace">
      {`${pct}%`}
    </text>
  )
}

export default function ProtocolPie() {
  const distribution = useNetworkStore(s => s.protocolDistribution)

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Protocols</span>
        <span className="text-xs text-muted font-mono">
          {distribution.reduce((s, d) => s + d.count, 0).toLocaleString()} pkts
        </span>
      </div>

      <div className="flex-1 min-h-0 flex items-center">
        {distribution.length === 0 ? (
          <div className="w-full text-center text-muted text-xs">Capturing...</div>
        ) : (
          <div className="w-full flex items-center gap-2 px-2">
            {/* Donut */}
            <div className="flex-shrink-0" style={{ width: 100, height: 100 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distribution}
                    dataKey="count"
                    nameKey="protocol"
                    cx="50%"
                    cy="50%"
                    innerRadius={28}
                    outerRadius={46}
                    strokeWidth={0}
                    labelLine={false}
                    label={renderCustomLabel}
                  >
                    {distribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex-1 min-w-0 space-y-0.5 overflow-y-auto max-h-24">
              {distribution.slice(0, 8).map((d, i) => (
                <div key={d.protocol} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="flex-shrink-0 w-2 h-2 rounded-sm"
                    style={{ background: COLORS[i % COLORS.length] }}
                  />
                  <span className="font-mono text-slate-300 truncate">{d.protocol}</span>
                  <span className="ml-auto font-mono text-muted flex-shrink-0">{d.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
