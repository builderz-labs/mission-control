'use client'

/**
 * useGatewayProxyStream
 *
 * Client-side hook that connects to /api/gateway-proxy/stream (SSE) instead
 * of a direct browser WebSocket to the OpenClaw gateway.
 *
 * Used when NEXT_PUBLIC_GATEWAY_PROXY_MODE=1.  The hook mirrors the shape of
 * the gateway event dispatch in useWebSocket so that the rest of the UI is
 * unaffected by the transport switch.
 */

import { useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'
import { normalizeModel } from '@/lib/utils'
import { createClientLogger } from '@/lib/client-logger'
import { GATEWAY_PROXY_MODE } from '@/lib/proxy-config'

const log = createClientLogger('GatewayProxyStream')

/**
 * Normalize the conversation_id coming from an OpenClaw gateway chat.message
 * event so it matches the Mission Control UI format ("agent_<name>").
 *
 * OpenClaw uses session-key format ("agent:name:type") for conversation IDs.
 * When it's absent or in that format we derive the UI-format ID from from_agent.
 */
function normalizeChatConversationId(payload: any): string {
  const cid = payload?.conversation_id
  if (cid) {
    // Convert "agent:name:type" → "agent_name"
    const m = String(cid).match(/^agent:([^:]+):/)
    if (m) return `agent_${m[1]}`
    return String(cid)
  }
  // Fallback: derive from the sender when conversation_id is absent
  if (payload?.from_agent && payload.from_agent !== 'human' && payload.from_agent !== 'system') {
    return `agent_${payload.from_agent}`
  }
  return `conv_${Date.now()}`
}

const MAX_RECONNECT_ATTEMPTS = 20
const BASE_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000
const JITTER_FACTOR = 0.5

export function useGatewayProxyStream() {
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const attemptsRef = useRef(0)
  const mountedRef = useRef(true)

  const {
    setConnection,
    setSessions,
    addLog,
    updateAgent,
    addChatMessage,
    addNotification,
    setCronJobs,
    addTokenUsage,
    updateSpawnRequest,
  } = useMissionControl()

  useEffect(() => {
    mountedRef.current = true

    // Skip entirely when proxy mode is not enabled
    if (!GATEWAY_PROXY_MODE) {
      return
    }

    function connect() {
      if (!mountedRef.current) return

      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      log.info('Connecting to /api/gateway-proxy/stream')
      const es = new EventSource('/api/gateway-proxy/stream')
      esRef.current = es

      es.onopen = () => {
        if (!mountedRef.current) return
        attemptsRef.current = 0
        setConnection({ isConnected: true, reconnectAttempts: 0 })
        log.info('Gateway proxy stream connected')
      }

      es.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const frame = JSON.parse(event.data)
          handleFrame(frame)
        } catch {
          // ignore malformed frames
        }
      }

      es.onerror = () => {
        if (!mountedRef.current) return
        setConnection({ isConnected: false })
        es.close()
        esRef.current = null

        const attempts = attemptsRef.current
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          log.error('Max proxy stream reconnect attempts reached')
          return
        }
        const base = Math.min(BASE_RECONNECT_MS * Math.pow(2, attempts), MAX_RECONNECT_MS)
        const delay = Math.round(base + Math.random() * base * JITTER_FACTOR)
        attemptsRef.current = attempts + 1
        setConnection({ reconnectAttempts: attempts + 1 })
        log.warn(`Reconnecting proxy stream in ${delay}ms (attempt ${attempts + 1})`)
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, delay)
      }
    }

    function handleFrame(frame: any) {
      if (!frame || typeof frame !== 'object') return

      // Initial connection ack from stream endpoint
      if (frame.type === 'connected') {
        return
      }

      // Pong / heartbeat — no store update needed
      if (frame.type === 'pong') {
        return
      }

      if (frame.type === 'event') {
        const { event: eventName, payload } = frame

        if (eventName === 'tick') {
          const data = payload || {}
          if (Array.isArray(data.sessions)) {
            setSessions(
              data.sessions.map((s: any) => ({
                key: s.key || s.sessionId || `session-${Date.now()}`,
                agent: s.agent || 'unknown',
                sessionId: s.sessionId || '',
                updatedAt: s.updatedAt || Date.now(),
                chatType: s.chatType || 'unknown',
                channel: s.channel || '',
                model: normalizeModel(s.model || ''),
                totalTokens: s.totalTokens || 0,
                inputTokens: s.inputTokens || 0,
                outputTokens: s.outputTokens || 0,
                contextTokens: s.contextTokens || 0,
                active: s.active ?? false,
                startTime: s.updatedAt || Date.now(),
                lastActivity: s.updatedAt || Date.now(),
                messageCount: s.messageCount || 0,
                cost: s.cost || 0,
              })),
            )
          }
          if (Array.isArray(data.cronJobs)) {
            setCronJobs(data.cronJobs)
          }
          return
        }

        if (eventName === 'log') {
          if (payload) {
            addLog({
              id: payload.id || `log-${Date.now()}-${Math.random()}`,
              timestamp: payload.timestamp || Date.now(),
              level: payload.level || 'info',
              source: payload.source || 'gateway',
              session: payload.session,
              message: payload.message || '',
              data: payload.extra || payload.data,
            })
          }
          return
        }

        if (eventName === 'chat.message') {
          if (payload) {
            addChatMessage({
              id: payload.id,
              conversation_id: normalizeChatConversationId(payload),
              from_agent: payload.from_agent,
              to_agent: payload.to_agent,
              content: payload.content,
              message_type: payload.message_type || 'text',
              metadata: payload.metadata,
              read_at: payload.read_at,
              created_at: payload.created_at || Math.floor(Date.now() / 1000),
            })
          }
          return
        }

        if (eventName === 'notification') {
          if (payload) {
            addNotification({
              id: payload.id,
              recipient: payload.recipient || 'operator',
              type: payload.type || 'info',
              title: payload.title || '',
              message: payload.message || '',
              source_type: payload.source_type,
              source_id: payload.source_id,
              created_at: payload.created_at || Math.floor(Date.now() / 1000),
            })
          }
          return
        }

        if (eventName === 'agent.status') {
          if (payload?.id) {
            updateAgent(payload.id, {
              status: payload.status,
              last_seen: payload.last_seen,
              last_activity: payload.last_activity,
            })
          }
          return
        }

        if (eventName === 'spawn_result') {
          if (payload) {
            updateSpawnRequest(payload.requestId || payload.id, {
              status: payload.status,
              error: payload.error,
            })
            if (payload.tokenUsage) {
              addTokenUsage(payload.tokenUsage)
            }
          }
          return
        }
      }

      // status / cron_status frames
      if (frame.type === 'status') {
        if (Array.isArray(frame.data?.cronJobs)) {
          setCronJobs(frame.data.cronJobs)
        }
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setConnection({ isConnected: false })
    }
  }, [
    setConnection,
    setSessions,
    addLog,
    updateAgent,
    addChatMessage,
    addNotification,
    setCronJobs,
    addTokenUsage,
    updateSpawnRequest,
  ])
}
