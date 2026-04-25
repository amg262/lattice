import { useEffect, useRef, useState, useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { TileLayer } from '@deck.gl/geo-layers'
import { ArcLayer, ScatterplotLayer, TextLayer, BitmapLayer } from '@deck.gl/layers'
import { useNetworkStore } from '../stores/networkStore'
import type { GeoFlow } from '../types'

// ---------------------------------------------------------------------------
// Protocol → RGBA color
// ---------------------------------------------------------------------------
const PROTO_RGBA: Record<string, [number, number, number, number]> = {
  TLS:   [34,  197, 94,  220],
  DNS:   [245, 158, 11,  220],
  HTTP:  [59,  130, 246, 220],
  SSH:   [167, 139, 250, 220],
  ICMP:  [148, 163, 184, 180],
  ARP:   [100, 116, 139, 160],
  TCP:   [96,  165, 250, 200],
  UDP:   [52,  211, 153, 200],
  DHCP:  [251, 146, 60,  200],
  NTP:   [192, 132, 252, 200],
  Other: [71,  85,  105, 160],
}

function protoColor(proto: string): [number, number, number, number] {
  return PROTO_RGBA[proto] ?? PROTO_RGBA.Other
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countryFlag(cc: string): string {
  if (!cc || cc.length !== 2) return ''
  const codePoints = cc.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  return String.fromCodePoint(...codePoints)
}

function formatBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`
  if (b >= 1_000) return `${(b / 1_000).toFixed(0)}KB`
  return `${b}B`
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
interface TooltipInfo {
  x: number
  y: number
  object: any
  layer: string
}

function MapTooltip({ info }: { info: TooltipInfo | null }) {
  if (!info) return null
  const { x, y, object, layer } = info
  const leftAligned = x > window.innerWidth / 2

  return (
    <div
      className="fixed z-50 pointer-events-none bg-surface-2 border border-border rounded-lg shadow-xl px-3 py-2.5 text-xs font-mono"
      style={{
        left: leftAligned ? undefined : x + 12,
        right: leftAligned ? window.innerWidth - x + 12 : undefined,
        top: y + 12,
        maxWidth: 280,
      }}
    >
      {layer === 'arc' && object && (
        <>
          <div className="text-slate-200 font-semibold mb-1.5 flex items-center gap-2">
            <span>{object.country_code && countryFlag(object.country_code)}</span>
            <span>{object.city || object.country || object.remote_ip}</span>
          </div>
          <TooltipRow label="IP" value={object.remote_ip} />
          <TooltipRow
            label="Proto"
            value={object.protocol}
            color={`rgb(${protoColor(object.protocol).slice(0, 3).join(',')})`}
          />
          {object.isp && <TooltipRow label="ISP" value={object.isp} />}
          {object.org && object.org !== object.isp && <TooltipRow label="Org" value={object.org} />}
          <TooltipRow label="Bytes" value={formatBytes(object.bytes)} />
          {object.dst_port && <TooltipRow label="Port" value={String(object.dst_port)} />}
        </>
      )}
      {layer === 'dot' && object && (
        <>
          <div className="text-slate-200 font-semibold mb-1.5">
            {object.country_code && countryFlag(object.country_code)}{' '}
            {object.city || object.country}
          </div>
          <TooltipRow label="IP" value={object.remote_ip} />
          {object.isp && <TooltipRow label="ISP" value={object.isp} />}
          <TooltipRow label="Country" value={object.country} />
        </>
      )}
    </div>
  )
}

function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex gap-2 leading-5">
      <span className="text-muted w-12 flex-shrink-0">{label}</span>
      <span style={{ color: color ?? '#cbd5e1' }} className="truncate">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dedup flows: keep latest per remote_ip, aggregate bytes
// ---------------------------------------------------------------------------
type AggregatedFlow = GeoFlow & { totalBytes: number; count: number }

function aggregateFlows(flows: GeoFlow[]): AggregatedFlow[] {
  const byIp = new Map<string, AggregatedFlow>()
  for (const f of flows) {
    const existing = byIp.get(f.remote_ip)
    if (existing) {
      existing.totalBytes += f.bytes
      existing.count += 1
      if (f.ts > existing.ts) {
        existing.ts = f.ts
        existing.protocol = f.protocol
      }
    } else {
      byIp.set(f.remote_ip, { ...f, totalBytes: f.bytes, count: 1 })
    }
  }
  return Array.from(byIp.values())
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const INITIAL_VIEW = {
  longitude: 0,
  latitude: 20,
  zoom: 1.8,
  pitch: 30,
  bearing: 0,
}

// Animation tick interval: 100ms ≈ 10fps is plenty for slow opacity fades
const ANIM_INTERVAL_MS = 100

export default function WorldMap() {
  const geoFlows = useNetworkStore(s => s.geoFlows)
  const myLocation = useNetworkStore(s => s.myLocation)

  const [viewState, setViewState] = useState(INITIAL_VIEW)
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
  // Animation time in seconds — updated at 10fps, not 60fps
  const [animTime, setAnimTime] = useState(0)
  const startTimeRef = useRef(Date.now())
  const hasFlownToHomeRef = useRef(false)

  // Defer DeckGL mount by one animation frame so the container has its CSS
  // dimensions computed before deck.gl/luma.gl creates the WebGL context.
  // Without this, the ResizeObserver fires while device=undefined, causing:
  //   "Cannot read properties of undefined (reading 'maxTextureDimension2D')"
  const [deckReady, setDeckReady] = useState(false)
  useEffect(() => {
    const rafId = requestAnimationFrame(() => setDeckReady(true))
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Throttled animation loop (10fps is plenty for opacity fades)
  useEffect(() => {
    const id = setInterval(() => {
      setAnimTime((Date.now() - startTimeRef.current) / 1000)
    }, ANIM_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Fly to home location once, the first time it loads
  useEffect(() => {
    if (myLocation && !hasFlownToHomeRef.current) {
      hasFlownToHomeRef.current = true
      setViewState(v => ({
        ...v,
        longitude: myLocation.lon,
        latitude: Math.max(-60, Math.min(60, myLocation.lat)),
        zoom: 2.5,
      }))
    }
  }, [myLocation])

  // Memoize the base tile layer — it never changes, creating it on every render
  // would cause unnecessary object churn with no visual benefit
  const tileLayer = useMemo(() => new TileLayer({
    id: 'base-tiles',
    data: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    ],
    maxRequests: 20,
    pickable: false,
    tileSize: 256,
    renderSubLayers: (props: any) => {
      const { boundingBox } = props.tile
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
      })
    },
  }), [])

  const aggregated = useMemo(() => aggregateFlows(geoFlows), [geoFlows])

  const myLon = myLocation?.lon ?? 0
  const myLat = myLocation?.lat ?? 0

  // Home dot — only changes when myLocation changes
  const homeLayer = useMemo(() => myLocation
    ? new ScatterplotLayer({
        id: 'home-dot',
        data: [myLocation],
        getPosition: () => [myLon, myLat],
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: [59, 130, 246, 255] as [number,number,number,number],
        getLineColor: [147, 197, 253, 200] as [number,number,number,number],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: false,
      })
    : null,
  [myLon, myLat])

  // Pulsing ring — animates, so needs animTime
  const homeRingLayer = useMemo(() => myLocation
    ? new ScatterplotLayer({
        id: 'home-ring',
        data: [myLocation],
        getPosition: () => [myLon, myLat],
        getRadius: 14 + Math.sin(animTime * 2) * 4,
        radiusUnits: 'pixels',
        getFillColor: [59, 130, 246, 0] as [number,number,number,number],
        getLineColor: [59, 130, 246, Math.round(80 + Math.sin(animTime * 2) * 50)] as [number,number,number,number],
        lineWidthMinPixels: 1.5,
        stroked: true,
        pickable: false,
        updateTriggers: { getRadius: animTime, getLineColor: animTime },
      })
    : null,
  [myLon, myLat, animTime])

  // Remote dots — fade with age, animTime drives re-evaluation
  const dotLayer = useMemo(() => new ScatterplotLayer({
    id: 'remote-dots',
    data: aggregated,
    getPosition: (d: AggregatedFlow) => [d.lon, d.lat],
    getRadius: (d: AggregatedFlow) => 5 + Math.min(d.count * 0.5, 6),
    radiusMinPixels: 4,
    radiusMaxPixels: 14,
    getFillColor: (d: AggregatedFlow) => {
      const c = protoColor(d.protocol)
      const age = (Date.now() - new Date(d.ts).getTime()) / 1000
      const opacity = age < 10 ? 255 : Math.max(120, 255 - (age - 10) * 3)
      return [c[0], c[1], c[2], Math.round(opacity)] as [number,number,number,number]
    },
    getLineColor: (d: AggregatedFlow) => protoColor(d.protocol),
    lineWidthMinPixels: 1,
    stroked: true,
    pickable: true,
    updateTriggers: { getFillColor: animTime, data: aggregated.length },
    onHover: ({ object, x, y }: any) => {
      setTooltip(object ? { x, y, object, layer: 'dot' } : null)
    },
  }), [aggregated, animTime])

  // Arc layer — the money shot; colors fade with age
  const arcLayer = useMemo(() => new ArcLayer({
    id: 'traffic-arcs',
    data: aggregated,
    getSourcePosition: () => [myLon, myLat],
    getTargetPosition: (d: AggregatedFlow) => [d.lon, d.lat],
    getSourceColor: (d: AggregatedFlow) => {
      const c = protoColor(d.protocol)
      const age = (Date.now() - new Date(d.ts).getTime()) / 1000
      const opacity = age < 8 ? 220 : Math.max(40, 220 - (age - 8) * 4)
      return [c[0], c[1], c[2], Math.round(opacity)] as [number,number,number,number]
    },
    getTargetColor: (d: AggregatedFlow) => {
      const c = protoColor(d.protocol)
      const age = (Date.now() - new Date(d.ts).getTime()) / 1000
      const opacity = age < 8 ? 180 : Math.max(20, 180 - (age - 8) * 4)
      return [c[0], c[1], c[2], Math.round(opacity)] as [number,number,number,number]
    },
    getWidth: (d: AggregatedFlow) => Math.min(1 + Math.log1p(d.totalBytes / 1000), 4),
    widthMinPixels: 1,
    widthMaxPixels: 5,
    greatCircle: true,
    pickable: true,
    updateTriggers: {
      getSourceColor: animTime,
      getTargetColor: animTime,
      getSourcePosition: [myLon, myLat],
      data: aggregated.length,
    },
    onHover: ({ object, x, y }: any) => {
      setTooltip(object ? { x, y, object, layer: 'arc' } : null)
    },
  }), [aggregated, myLon, myLat, animTime])

  // City labels for recently-active destinations only
  const recentAggregated = useMemo(
    () => aggregated.filter(f => (Date.now() - new Date(f.ts).getTime()) / 1000 < 30),
    [aggregated, animTime],
  )

  const labelLayer = useMemo(() => new TextLayer({
    id: 'city-labels',
    data: recentAggregated,
    getPosition: (d: AggregatedFlow) => [d.lon, d.lat + 0.8],
    getText: (d: AggregatedFlow) => d.city || d.country || '',
    getSize: 11,
    getColor: [226, 232, 240, 180] as [number,number,number,number],
    getAngle: 0,
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'bottom',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 500,
    billboard: true,
    pickable: false,
    updateTriggers: { data: recentAggregated.length },
  }), [recentAggregated])

  const layers = useMemo(
    () => [tileLayer, homeRingLayer, homeLayer, dotLayer, arcLayer, labelLayer].filter(Boolean),
    [tileLayer, homeRingLayer, homeLayer, dotLayer, arcLayer, labelLayer],
  )

  return (
    <div className="relative w-full h-full bg-surface">
      {deckReady && (
        <DeckGL
          viewState={viewState}
          controller={{ dragPan: true, dragRotate: true, scrollZoom: true, touchZoom: true }}
          onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
          layers={layers as any}
          getCursor={({ isDragging, isHovering }: any) =>
            isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
          }
        />
      )}

      <MapTooltip info={tooltip} />

      {/* Protocol legend */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 pointer-events-none">
        {Object.entries(PROTO_RGBA).slice(0, 7).map(([proto, rgba]) => (
          <div key={proto} className="flex items-center gap-2 text-xs font-mono">
            <span
              className="w-6 h-0.5 rounded-full inline-block"
              style={{ background: `rgba(${rgba.slice(0, 3).join(',')},0.9)` }}
            />
            <span style={{ color: `rgba(${rgba.slice(0, 3).join(',')},0.85)` }}>{proto}</span>
          </div>
        ))}
      </div>

      {/* My location badge */}
      {myLocation && (
        <div className="absolute bottom-4 right-4 bg-surface-2/90 border border-border rounded-lg px-3 py-2 text-xs font-mono pointer-events-none">
          <div className="text-muted mb-0.5">Your location</div>
          <div className="text-accent-glow font-semibold">
            {countryFlag(myLocation.country_code)} {myLocation.city || myLocation.country}
          </div>
          <div className="text-muted">{myLocation.ip}</div>
        </div>
      )}

      {/* Empty state */}
      {aggregated.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted pointer-events-none">
          <svg className="w-14 h-14 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.8}
              d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253" />
          </svg>
          <div className="text-sm">Waiting for external traffic...</div>
          <div className="text-xs opacity-60">IPs are geolocated as they appear in your packet capture</div>
        </div>
      )}

      {/* Stats bar */}
      {aggregated.length > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-4 bg-surface-2/80 backdrop-blur-sm border border-border rounded-full px-4 py-1.5 text-xs font-mono pointer-events-none">
          <span className="text-muted">destinations</span>
          <span className="text-accent-glow font-semibold">{aggregated.length}</span>
          <span className="text-border">|</span>
          <span className="text-muted">flows</span>
          <span className="text-accent-glow font-semibold">{geoFlows.length}</span>
        </div>
      )}
    </div>
  )
}
