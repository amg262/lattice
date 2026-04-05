import { create } from 'zustand'
import type { Device, Connection, Talker, ProtocolEntry, Stats, GeoFlow, GeoLocation } from '../types'

const MAX_CONNECTIONS = 200
const MAX_GEO_FLOWS = 150

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
  }) => void
  selectDevice: (ip: string | null) => void
  setMyLocation: (loc: GeoLocation) => void
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

      return {
        lastUpdate: snapshot.ts,
        stats: snapshot.stats ?? state.stats,
        devices: snapshot.devices ?? state.devices,
        connections: merged,
        topTalkers: snapshot.top_talkers ?? state.topTalkers,
        protocolDistribution: snapshot.protocol_distribution ?? state.protocolDistribution,
        geoFlows: mergedGeo,
        myLocation: snapshot.my_location ?? state.myLocation,
      }
    }),

  selectDevice: (ip) => set({ selectedIp: ip }),
  setMyLocation: (loc) => set({ myLocation: loc }),
}))
