import { create } from 'zustand'
import type { Device, Connection, Talker, ProtocolEntry, Stats } from '../types'

const MAX_CONNECTIONS = 200

interface NetworkState {
  // Connection
  wsConnected: boolean
  lastUpdate: string | null

  // Data
  devices: Device[]
  connections: Connection[]
  topTalkers: Talker[]
  protocolDistribution: ProtocolEntry[]
  stats: Stats

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
  }) => void
  selectDevice: (ip: string | null) => void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  wsConnected: false,
  lastUpdate: null,

  devices: [],
  connections: [],
  topTalkers: [],
  protocolDistribution: [],
  stats: { total_devices: 0, alive_devices: 0, top_protocol: '—' },

  selectedIp: null,

  setWsConnected: (v) => set({ wsConnected: v }),

  applySnapshot: (snapshot) =>
    set((state) => {
      // Merge new connections into rolling ring buffer
      const incoming = snapshot.connections ?? []
      const merged = [...incoming, ...state.connections]
        .filter(
          (c, i, arr) =>
            arr.findIndex((x) => x.ts === c.ts && x.src_ip === c.src_ip && x.dst_ip === c.dst_ip) === i,
        )
        .slice(0, MAX_CONNECTIONS)

      return {
        lastUpdate: snapshot.ts,
        stats: snapshot.stats ?? state.stats,
        devices: snapshot.devices ?? state.devices,
        connections: merged,
        topTalkers: snapshot.top_talkers ?? state.topTalkers,
        protocolDistribution: snapshot.protocol_distribution ?? state.protocolDistribution,
      }
    }),

  selectDevice: (ip) => set({ selectedIp: ip }),
}))
