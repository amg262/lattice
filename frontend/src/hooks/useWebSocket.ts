import { useEffect, useRef } from 'react'
import { useNetworkStore } from '../stores/networkStore'
import type { WSSnapshot } from '../types'

const WS_URL = 'ws://localhost:8000/ws'
const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const { setWsConnected, applySnapshot } = useNetworkStore()

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [])

  function connect() {
    if (!mountedRef.current) return

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setWsConnected(true)
        console.log('[Lattice] WebSocket connected')
      }

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(ev.data) as WSSnapshot
          if (msg.type === 'snapshot') {
            applySnapshot(msg)
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        // Will trigger onclose
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setWsConnected(false)
        console.log(`[Lattice] WebSocket disconnected — retrying in ${RECONNECT_DELAY_MS}ms`)
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    } catch {
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  }
}
