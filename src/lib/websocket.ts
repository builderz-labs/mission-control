'use client'

import { useCallback, useRef, useEffect } from 'react'
import { useMissionControl } from '@/store'

// Gateway protocol version (v3 required by OpenClaw 2026.x)
const PROTOCOL_VERSION = 3

// Heartbeat configuration
const PING_INTERVAL_MS = 30_000
const MAX_MISSED_PONGS = 3

// Gateway message types
interface GatewayFrame {
  type: 'event' | 'req' | 'res'
  event?: string
  method?: string
  id?: string
  payload?: any
  ok?: boolean
  result?: any
  error?: any
  params?: any
}

interface GatewayMessage {
  type: 'session_update' | 'log' | 'event' | 'status' | 'spawn_result' | 'cron_status' | 'pong'
  data: any
  timestamp?: number
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const pingIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const maxReconnectAttempts = 10
  const reconnectUrl = useRef<string>('')
  const authTokenRef = useRef<string>('')
  const requestIdRef = useRef<number>(0)
  const handshakeCompleteRef = useRef<boolean>(false)

  // Heartbeat tracking
  const pingCounterRef = useRef<number>(0)
  const pingSentTimestamps = useRef<Map<string, number>>(new Map())
  const missedPongsRef = useRef<number>(0)

  const {
    connection,
    setConnection,
    setLastMessage,
    setSessions,
    addLog,
    updateSpawnRequest,
    setCronJobs,
    addTokenUsage,
    addChatMessage,
    addNotification,
    updateAgent,
    agents,
  } = useMissionControl()

  // Generate unique request ID
  const nextRequestId = () => {
    requestIdRef.current += 1
    return `mc-${requestIdRef.current}`
  }

  // Start heartbeat ping interval
  const startHeartbeat = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)

    pingIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !handshakeCompleteRef.current) return

      // Check missed pongs
      if (missedPongsRef.current >= MAX_MISSED_PONGS) {
        console.warn(`Missed ${MAX_MISSED_PONGS} pongs, triggering reconnect`)
        addLog({
          id: `heartbeat-${Date.now()}`,
          timestamp: Date.now(),
          level: 'warn',
          source: 'websocket',
          message: `No heartbeat response after ${MAX_MISSED_PONGS} attempts, reconnecting...`
        })
        // Force close to trigger reconnect
        wsRef.current?.close(4000, 'Heartbeat timeout')
        return
      }

      pingCounterRef.current += 1
      const pingId = `ping-${pingCounterRef.current}`
      pingSentTimestamps.current.set(pingId, Date.now())
      missedPongsRef.current += 1

      const pingFrame = {
        type: 'req',
        method: 'ping',
        id: pingId,
      }

      try {
        wsRef.current.send(JSON.stringify(pingFrame))
      } catch {
        // Send failed, will be caught by reconnect logic
      }
    }, PING_INTERVAL_MS)
  }, [addLog])

  const stopHeartbeat = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = undefined
    }
    missedPongsRef.current = 0
    pingSentTimestamps.current.clear()
  }, [])

  // Handle pong response - calculate RTT
  const handlePong = useCallback((frameId: string) => {
    const sentAt = pingSentTimestamps.current.get(frameId)
    if (sentAt) {
      const rtt = Date.now() - sentAt
      pingSentTimestamps.current.delete(frameId)
      missedPongsRef.current = 0
      setConnection({ latency: rtt })
    }
  }, [setConnection])

  // Send the connect handshake
  const sendConnectHandshake = useCallback((ws: WebSocket, nonce?: string) => {
    const connectRequest = {
      type: 'req',
      method: 'connect',
      id: nextRequestId(),
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'gateway-client',
          displayName: 'Mission Control',
          version: '2.0.0',
          platform: 'web',
          mode: 'ui',
          instanceId: `mc-${Date.now()}`
        },
        role: 'operator',
        scopes: ['operator.admin'],
        auth: authTokenRef.current
          ? { password: authTokenRef.current }
          : undefined
      }
    }
    console.log('Sending connect handshake:', connectRequest)
    ws.send(JSON.stringify(connectRequest))
  }, [])

  // Parse and handle different gateway message types
  const handleGatewayMessage = useCallback((message: GatewayMessage) => {
    setLastMessage(message)

    // Debug logging for development
    if (process.env.NODE_ENV === 'development') {
      console.log('WebSocket message received:', message.type, message)
    }

    switch (message.type) {
      case 'session_update':
        if (message.data?.sessions) {
          setSessions(message.data.sessions.map((session: any, index: number) => ({
            id: session.key || `session-${index}`,
            key: session.key || '',
            kind: session.kind || 'unknown',
            age: session.age || '',
            model: session.model || '',
            tokens: session.tokens || '',
            flags: session.flags || [],
            active: session.active || false,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            messageCount: session.messageCount,
            cost: session.cost
          })))
        }
        break

      case 'log':
        if (message.data) {
          addLog({
            id: message.data.id || `log-${Date.now()}-${Math.random()}`,
            timestamp: message.data.timestamp || message.timestamp || Date.now(),
            level: message.data.level || 'info',
            source: message.data.source || 'gateway',
            session: message.data.session,
            message: message.data.message || '',
            data: message.data.extra || message.data.data
          })
        }
        break

      case 'spawn_result':
        if (message.data?.id) {
          updateSpawnRequest(message.data.id, {
            status: message.data.status,
            completedAt: message.data.completedAt,
            result: message.data.result,
            error: message.data.error
          })
        }
        break

      case 'cron_status':
        if (message.data?.jobs) {
          setCronJobs(message.data.jobs)
        }
        break

      case 'event':
        // Handle various gateway events
        if (message.data?.type === 'token_usage') {
          addTokenUsage({
            model: message.data.model,
            sessionId: message.data.sessionId,
            date: new Date().toISOString(),
            inputTokens: message.data.inputTokens || 0,
            outputTokens: message.data.outputTokens || 0,
            totalTokens: message.data.totalTokens || 0,
            cost: message.data.cost || 0
          })
        }
        break

      default:
        console.log('Unknown gateway message type:', message.type)
    }
  }, [setLastMessage, setSessions, addLog, updateSpawnRequest, setCronJobs, addTokenUsage])

  // Handle gateway protocol frames
  const handleGatewayFrame = useCallback((frame: GatewayFrame, ws: WebSocket) => {
    console.log('Gateway frame:', frame)

    // Handle connect challenge
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      console.log('Received connect challenge, sending handshake...')
      sendConnectHandshake(ws, frame.payload?.nonce)
      return
    }

    // Handle connect response (handshake success)
    if (frame.type === 'res' && frame.ok && !handshakeCompleteRef.current) {
      console.log('Handshake complete!')
      handshakeCompleteRef.current = true
      setConnection({
        isConnected: true,
        lastConnected: new Date(),
        reconnectAttempts: 0
      })
      // Start heartbeat after successful handshake
      startHeartbeat()
      return
    }

    // Handle pong responses (any response to a ping ID counts — even errors prove the connection is alive)
    if (frame.type === 'res' && frame.id?.startsWith('ping-')) {
      handlePong(frame.id)
      return
    }

    // Handle connect error
    if (frame.type === 'res' && !frame.ok) {
      console.error('Gateway error:', frame.error)
      addLog({
        id: `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'gateway',
        message: `Gateway error: ${frame.error?.message || JSON.stringify(frame.error)}`
      })
      return
    }

    // Handle broadcast events (tick, log, chat, notification, agent status, etc.)
    if (frame.type === 'event') {
      if (frame.event === 'tick') {
        // Tick event contains snapshot data
        const snapshot = frame.payload?.snapshot
        if (snapshot?.sessions) {
          setSessions(snapshot.sessions.map((session: any, index: number) => ({
            id: session.key || `session-${index}`,
            key: session.key || '',
            kind: session.kind || 'unknown',
            age: formatAge(session.updatedAt),
            model: session.model || '',
            tokens: `${session.totalTokens || 0}/${session.contextTokens || 35000}`,
            flags: [],
            active: isActive(session.updatedAt),
            startTime: session.updatedAt,
            lastActivity: session.updatedAt,
            messageCount: session.messageCount,
            cost: session.cost
          })))
        }
      } else if (frame.event === 'log') {
        const logData = frame.payload
        if (logData) {
          addLog({
            id: logData.id || `log-${Date.now()}-${Math.random()}`,
            timestamp: logData.timestamp || Date.now(),
            level: logData.level || 'info',
            source: logData.source || 'gateway',
            session: logData.session,
            message: logData.message || '',
            data: logData.extra || logData.data
          })
        }
      } else if (frame.event === 'chat.message') {
        // Real-time chat message from gateway
        const msg = frame.payload
        if (msg) {
          addChatMessage({
            id: msg.id,
            conversation_id: msg.conversation_id,
            from_agent: msg.from_agent,
            to_agent: msg.to_agent,
            content: msg.content,
            message_type: msg.message_type || 'text',
            metadata: msg.metadata,
            read_at: msg.read_at,
            created_at: msg.created_at || Math.floor(Date.now() / 1000),
          })
        }
      } else if (frame.event === 'notification') {
        // Real-time notification from gateway
        const notif = frame.payload
        if (notif) {
          addNotification({
            id: notif.id,
            recipient: notif.recipient || 'operator',
            type: notif.type || 'info',
            title: notif.title || '',
            message: notif.message || '',
            source_type: notif.source_type,
            source_id: notif.source_id,
            created_at: notif.created_at || Math.floor(Date.now() / 1000),
          })
        }
      } else if (frame.event === 'agent.status') {
        // Real-time agent status update
        const data = frame.payload
        if (data?.id) {
          updateAgent(data.id, {
            status: data.status,
            last_seen: data.last_seen,
            last_activity: data.last_activity,
          })
        }
      }
    }
  }, [sendConnectHandshake, setConnection, setSessions, addLog, startHeartbeat, handlePong, addChatMessage, addNotification, updateAgent])

  const connect = useCallback((url: string, token?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    // Extract token from URL if present
    const urlObj = new URL(url, window.location.origin)
    const urlToken = urlObj.searchParams.get('token')
    authTokenRef.current = token || urlToken || ''

    // Remove token from URL (we'll send it in handshake)
    urlObj.searchParams.delete('token')

    reconnectUrl.current = url
    handshakeCompleteRef.current = false

    try {
      const ws = new WebSocket(url.split('?')[0]) // Connect without query params
      wsRef.current = ws

      ws.onopen = () => {
        console.log('WebSocket connected to', url.split('?')[0])
        // Don't set isConnected yet - wait for handshake
        setConnection({
          url: url.split('?')[0],
          reconnectAttempts: 0
        })
        // Wait for connect.challenge from server
        console.log('Waiting for connect challenge...')
      }

      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as GatewayFrame
          handleGatewayFrame(frame, ws)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
          addLog({
            id: `raw-${Date.now()}`,
            timestamp: Date.now(),
            level: 'debug',
            source: 'websocket',
            message: `Raw message: ${event.data}`
          })
        }
      }

      ws.onclose = (event) => {
        console.log('Disconnected from Gateway:', event.code, event.reason)
        setConnection({ isConnected: false })
        handshakeCompleteRef.current = false
        stopHeartbeat()

        // Auto-reconnect logic with exponential backoff
        if (connection.reconnectAttempts < maxReconnectAttempts) {
          const timeout = Math.min(Math.pow(2, connection.reconnectAttempts) * 1000, 30000)
          console.log(`Reconnecting in ${timeout}ms... (attempt ${connection.reconnectAttempts + 1}/${maxReconnectAttempts})`)

          reconnectTimeoutRef.current = setTimeout(() => {
            setConnection({ reconnectAttempts: connection.reconnectAttempts + 1 })
            connect(url, authTokenRef.current)
          }, timeout)
        } else {
          console.error('Max reconnection attempts reached.')
          addLog({
            id: `error-${Date.now()}`,
            timestamp: Date.now(),
            level: 'error',
            source: 'websocket',
            message: 'Max reconnection attempts reached. Please reconnect manually.'
          })
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        addLog({
          id: `error-${Date.now()}`,
          timestamp: Date.now(),
          level: 'error',
          source: 'websocket',
          message: `WebSocket error occurred`
        })
      }

    } catch (error) {
      console.error('Failed to connect to WebSocket:', error)
      setConnection({ isConnected: false })
    }
  }, [connection.reconnectAttempts, setConnection, handleGatewayFrame, addLog, stopHeartbeat])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    stopHeartbeat()

    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect')
      wsRef.current = null
    }

    handshakeCompleteRef.current = false
    setConnection({
      isConnected: false,
      reconnectAttempts: 0,
      latency: undefined
    })
  }, [setConnection, stopHeartbeat])

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && handshakeCompleteRef.current) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    return false
  }, [])

  const reconnect = useCallback(() => {
    disconnect()
    if (reconnectUrl.current) {
      setTimeout(() => connect(reconnectUrl.current, authTokenRef.current), 1000)
    }
  }, [connect, disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    isConnected: connection.isConnected,
    connectionState: connection,
    connect,
    disconnect,
    reconnect,
    sendMessage
  }
}

// Helper functions
function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

function isActive(timestamp: number): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp < 60 * 60 * 1000
}
