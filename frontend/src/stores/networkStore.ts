import { create } from 'zustand'
import type { Device, Connection, Talker, ProtocolEntry, Stats, GeoFlow, GeoLocation, DnsEntry, NetworkEvent } from '../types'

const MAX_CONNECTIONS = 200
const MAX_GEO_FLOWS = 150
const MAX_DNS_LOG = 500

interface NetworkState {
  // Connection
  wsConnected: boolean
  lastUpdate: string | null

  // LAN data
  devices: Device[]
  connections: Connection[]
  topTalkers: Talker[]
  protocolDistribution: ProtocolEntry[]
  stats: Stats

  // Geo / map data
  geoFlows: GeoFlow[]
  myLocation: GeoLocation | null

  // Spy log
  dnsLog: DnsEntry[]

  // Alerts
  events: NetworkEvent[]
  alertsLastViewed: string | null  // ISO timestamp

  // Selected device for detail view
  selectedIp: string | null

  // Actions
  setWsConnected: (v: boolean) => void
  applySnapshot: (snapshot: {
    ts: string
    stats: Stats
    devices: Device[]
    connections: Connection[]
    top_talkers: Talker[]
    protocol_distribution: ProtocolEntry[]
    geo_flows?: GeoFlow[]
    my_location?: GeoLocation | null
    dns_live?: DnsEntry[]
    events?: NetworkEvent[]
  }) => void
  selectDevice: (ip: string | null) => void
  setMyLocation: (loc: GeoLocation) => void
  markAlertsViewed: () => void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  wsConnected: false,
  lastUpdate: null,

  devices: [],
  connections: [],
  topTalkers: [],
  protocolDistribution: [],
  stats: { total_devices: 0, alive_devices: 0, top_protocol: '—' },

  geoFlows: [],
  myLocation: null,

  dnsLog: [],
  events: [],
  alertsLastViewed: null,

  selectedIp: null,

  setWsConnected: (v) => set({ wsConnected: v }),

  applySnapshot: (snapshot) =>
    set((state) => {
      // Merge LAN connections
      const incoming = snapshot.connections ?? []
      const merged = [...incoming, ...state.connections]
        .filter(
          (c, i, arr) =>
            arr.findIndex((x) => x.ts === c.ts && x.src_ip === c.src_ip && x.dst_ip === c.dst_ip) === i,
        )
        .slice(0, MAX_CONNECTIONS)

      // Merge geo flows (newest first, dedup by ts+remote_ip)
      const incomingGeo = snapshot.geo_flows ?? []
      const mergedGeo = [...incomingGeo, ...state.geoFlows]
        .filter(
          (f, i, arr) =>
            arr.findIndex((x) => x.ts === f.ts && x.remote_ip === f.remote_ip) === i,
        )
        .slice(0, MAX_GEO_FLOWS)

      // Merge DNS log (newest first, dedup by ts+src_ip+domain)
      const incomingDns = snapshot.dns_live ?? []
      const mergedDns = [...incomingDns, ...state.dnsLog]
        .filter(
          (d, i, arr) =>
            arr.findIndex((x) => x.ts === d.ts && x.src_ip === d.src_ip && x.domain === d.domain) === i,
        )
        .slice(0, MAX_DNS_LOG)

      // Merge events (newest first, dedup by ts+event_type+device_ip)
      const incomingEvents = snapshot.events ?? []
      const mergedEvents = [...incomingEvents, ...state.events]
        .filter(
          (e, i, arr) =>
            arr.findIndex((x) => x.ts === e.ts && x.event_type === e.event_type && x.device_ip === e.device_ip) === i,
        )
        .slice(0, 200)

      return {
        lastUpdate: snapshot.ts,
        stats: snapshot.stats ?? state.stats,
        devices: snapshot.devices ?? state.devices,
        connections: merged,
        topTalkers: snapshot.top_talkers ?? state.topTalkers,
        protocolDistribution: snapshot.protocol_distribution ?? state.protocolDistribution,
        geoFlows: mergedGeo,
        myLocation: snapshot.my_location ?? state.myLocation,
        dnsLog: mergedDns,
        events: mergedEvents,
      }
    }),

  selectDevice: (ip) => set({ selectedIp: ip }),
  setMyLocation: (loc) => set({ myLocation: loc }),
  markAlertsViewed: () => set({ alertsLastViewed: new Date().toISOString() }),
}))
