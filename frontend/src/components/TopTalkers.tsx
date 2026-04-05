import { useNetworkStore } from '../stores/networkStore'

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)}GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}KB`
  return `${bytes}B`
}

export default function TopTalkers() {
  const talkers = useNetworkStore(s => s.topTalkers)
  const devices = useNetworkStore(s => s.devices)
  const selectDevice = useNetworkStore(s => s.selectDevice)
  const selectedIp = useNetworkStore(s => s.selectedIp)

  const deviceMap = new Map(devices.map(d => [d.ip, d]))
  const maxBytes = talkers.length > 0 ? talkers[0].bytes_out : 1

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="panel-title">Top Talkers</span>
        <span className="text-xs text-muted">5 min window</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {talkers.length === 0 ? (
          <div className="text-center text-muted text-xs py-4">Collecting traffic data...</div>
        ) : (
          talkers.map((t, i) => {
            const dev = deviceMap.get(t.ip)
            const name = dev?.hostname || dev?.vendor || t.ip
            const isSelected = selectedIp === t.ip
            const barWidth = maxBytes > 0 ? (t.bytes_out / maxBytes) * 100 : 0

            return (
              <div
                key={t.ip}
                onClick={() => selectDevice(isSelected ? null : t.ip)}
                className={`cursor-pointer rounded px-2 py-1.5 transition-colors ${
                  isSelected ? 'bg-accent/20 border border-accent/40' : 'hover:bg-surface-2'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-muted text-xs font-mono flex-shrink-0">#{i + 1}</span>
                    <span className="text-xs font-mono text-slate-300 truncate">{name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-xs font-mono text-accent-glow">{formatBytes(t.bytes_out)}</span>
                    <span className="text-xs text-muted">↑</span>
                    <span className="text-xs font-mono text-success">{formatBytes(t.bytes_in)}</span>
                    <span className="text-xs text-muted">↓</span>
                  </div>
                </div>

                {/* Bar */}
                <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${barWidth}%`,
                      background: `linear-gradient(90deg, #3b82f6, #60a5fa)`,
                    }}
                  />
                </div>

                {/* IP subtitle */}
                {name !== t.ip && (
                  <div className="text-xs font-mono text-muted mt-0.5">{t.ip}</div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
