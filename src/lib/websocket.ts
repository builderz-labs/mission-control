'use client'

import { useCallback, useRef, useEffect } from 'react'
import { useMissionControl } from '@/store'
import type { GatewayAdapterConfig } from '@/lib/gateway-adapters'
import { normalizeModel } from '@/lib/utils'
import {
  createGatewayAdapter,
  type GatewayAdapter,
  type GatewayFrame,
  type GatewayMessage,
} from '@/lib/gateway-websocket-adapters'

const GATEWAY_LOG_PREFIX = 'gateway-hook'
const MAX_RECONNECT_ATTEMPTS = 10

type GatewayLogLevel = 'info' | 'warn' | 'error' | 'debug'

function logWithConsole(level: GatewayLogLevel, message: string, meta?: unknown) {
  const formatted = `[${GATEWAY_LOG_PREFIX}] ${message}`
  const logFn = console[level] ?? console.log
  if (meta !== undefined) logFn(formatted, meta)
  else logFn(formatted)
}

const gatewayLogger = {
  info: (message: string, meta?: unknown) => logWithConsole('info', message, meta),
  warn: (message: string, meta?: unknown) => logWithConsole('warn', message, meta),
  error: (message: string, meta?: unknown) => logWithConsole('error', message, meta),
}

export function useWebSocket() {
  const adapterRef = useRef<GatewayAdapter | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const reconnectUrlRef = useRef<string>('')
  const authTokenRef = useRef<string>('')
  const reconnectAttemptsRef = useRef<number>(0)
  const manualDisconnectRef = useRef<boolean>(false)
  const adapterKindRef = useRef<string>('openclaw')
  const adapterNameRef = useRef<string>('openclaw')
  const connectRef = useRef<(url: string, token?: string, adapterKind?: string, adapterName?: string) => void>(() => {})

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
  } = useMissionControl()

  const handleGatewayMessage = useCallback((message: GatewayMessage) => {
    setLastMessage(message)

    switch (message.type) {
      case 'session_update':
        if (message.data?.sessions) {
          setSessions(message.data.sessions.map((session: any, index: number) => ({
            id: session.key || `session-${index}`,
            key: session.key || '',
            kind: session.kind || 'unknown',
            age: session.age || '',
            model: normalizeModel(session.model),
            tokens: session.tokens || '',
            flags: session.flags || [],
            active: session.active || false,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            messageCount: session.messageCount,
            cost: session.cost,
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
            data: message.data.extra || message.data.data,
          })
        }
        break

      case 'spawn_result':
        if (message.data?.id) {
          updateSpawnRequest(message.data.id, {
            status: message.data.status,
            completedAt: message.data.completedAt,
            result: message.data.result,
            error: message.data.error,
          })
        }
        break

      case 'cron_status':
        if (message.data?.jobs) setCronJobs(message.data.jobs)
        break

      case 'event':
        if (message.data?.type === 'token_usage') {
          addTokenUsage({
            model: normalizeModel(message.data.model),
            sessionId: message.data.sessionId,
            date: new Date().toISOString(),
            inputTokens: message.data.inputTokens || 0,
            outputTokens: message.data.outputTokens || 0,
            totalTokens: message.data.totalTokens || 0,
            cost: message.data.cost || 0,
          })
        }
        break
    }
  }, [setLastMessage, setSessions, addLog, updateSpawnRequest, setCronJobs, addTokenUsage])

  const handleGatewayFrame = useCallback((frame: GatewayFrame) => {
    if (frame.type === 'res' && !frame.ok) {
      addLog({
        id: `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'gateway',
        message: `Gateway error: ${frame.error?.message || JSON.stringify(frame.error)}`,
      })
      return
    }

    if (frame.type !== 'event') return

    if (frame.event === 'tick') {
      const snapshot = frame.payload?.snapshot
      if (snapshot?.sessions) {
        setSessions(snapshot.sessions.map((session: any, index: number) => ({
          id: session.key || `session-${index}`,
          key: session.key || '',
          kind: session.kind || 'unknown',
          age: formatAge(session.updatedAt),
          model: normalizeModel(session.model),
          tokens: `${session.totalTokens || 0}/${session.contextTokens || 35000}`,
          flags: [],
          active: isActive(session.updatedAt),
          startTime: session.updatedAt,
          lastActivity: session.updatedAt,
          messageCount: session.messageCount,
          cost: session.cost,
        })))
      }
      return
    }

    if (frame.event === 'log') {
      const logData = frame.payload
      if (logData) {
        addLog({
          id: logData.id || `log-${Date.now()}-${Math.random()}`,
          timestamp: logData.timestamp || Date.now(),
          level: logData.level || 'info',
          source: logData.source || 'gateway',
          session: logData.session,
          message: logData.message || '',
          data: logData.extra || logData.data,
        })
      }
      return
    }

    if (frame.event === 'chat.message') {
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
      return
    }

    if (frame.event === 'notification') {
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
      return
    }

    if (frame.event === 'agent.status') {
      const data = frame.payload
      if (data?.id) {
        updateAgent(data.id, {
          status: data.status,
          last_seen: data.last_seen,
          last_activity: data.last_activity,
        })
      }
    }
  }, [addLog, setSessions, addChatMessage, addNotification, updateAgent])

  const scheduleReconnect = useCallback(() => {
    if (manualDisconnectRef.current) return

    const attempts = reconnectAttemptsRef.current
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      addLog({
        id: `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'websocket',
        message: 'Max reconnection attempts reached. Please reconnect manually.',
      })
      return
    }

    const base = Math.min(Math.pow(2, attempts) * 1000, 30000)
    const timeout = Math.round(base + Math.random() * base * 0.5)
    reconnectAttemptsRef.current = attempts + 1
    setConnection({
      reconnectAttempts: attempts + 1,
      adapterKind: adapterKindRef.current,
      adapterName: adapterNameRef.current,
    })

    reconnectTimeoutRef.current = setTimeout(() => {
      connectRef.current(
        reconnectUrlRef.current,
        authTokenRef.current,
        adapterKindRef.current,
        adapterNameRef.current,
      )
    }, timeout)
  }, [setConnection, addLog])

  const connect = useCallback((url: string, token?: string, adapterKind = 'openclaw', adapterName?: string) => {
    const resolvedName = adapterName || adapterKind
    reconnectUrlRef.current = url
    authTokenRef.current = token || ''
    manualDisconnectRef.current = false
    adapterKindRef.current = adapterKind
    adapterNameRef.current = resolvedName

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }

    adapterRef.current?.disconnect(1000, 'Switch adapter')
    const adapter = createGatewayAdapter(adapterKind, resolvedName)
    adapterRef.current = adapter

    adapter.onOpen(() => {
      gatewayLogger.info('Gateway socket opened', { url, adapter: adapter.name })
      setConnection({
        url,
        reconnectAttempts: reconnectAttemptsRef.current,
        adapterKind,
        adapterName: resolvedName,
      })
    })

    adapter.onHeartbeat((latency) => {
      reconnectAttemptsRef.current = 0
      setConnection({
        isConnected: true,
        lastConnected: new Date(),
        reconnectAttempts: 0,
        latency,
        adapterKind,
        adapterName: resolvedName,
      })
    })

    adapter.onMessage(handleGatewayMessage)
    adapter.onFrame(handleGatewayFrame)

    adapter.onClose((event) => {
      gatewayLogger.warn('Disconnected from Gateway', { code: event.code, reason: event.reason })
      setConnection({
        isConnected: false,
        adapterKind,
        adapterName: resolvedName,
      })
      scheduleReconnect()
    })

    adapter.onError(() => {
      addLog({
        id: `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'websocket',
        message: 'WebSocket error occurred',
      })
    })

    try {
      adapter.connect(url, token)
    } catch (error) {
      gatewayLogger.error('Failed to connect to WebSocket', { error })
      setConnection({
        isConnected: false,
        adapterKind,
        adapterName: resolvedName,
      })
    }
  }, [setConnection, handleGatewayMessage, handleGatewayFrame, scheduleReconnect, addLog])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true
    reconnectAttemptsRef.current = 0

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }

    adapterRef.current?.disconnect(1000, 'Manual disconnect')
    adapterRef.current = null

    setConnection({
      isConnected: false,
      reconnectAttempts: 0,
      latency: undefined,
      adapterKind: adapterKindRef.current,
      adapterName: adapterNameRef.current,
    })
  }, [setConnection])

  const sendMessage = useCallback((message: any) => {
    return adapterRef.current?.send(message) || false
  }, [])

  const connectAdapter = useCallback((adapter: GatewayAdapterConfig) => {
    connect(adapter.wsUrl, adapter.token || '', adapter.kind, adapter.name)
  }, [connect])

  const reconnect = useCallback(() => {
    disconnect()
    if (reconnectUrlRef.current) {
      setTimeout(
        () => connect(
          reconnectUrlRef.current,
          authTokenRef.current,
          adapterKindRef.current,
          adapterNameRef.current,
        ),
        1000,
      )
    }
  }, [connect, disconnect])

  useEffect(() => () => disconnect(), [disconnect])

  return {
    isConnected: connection.isConnected,
    connectionState: connection,
    connect,
    disconnect,
    reconnect,
    sendMessage,
    connectAdapter,
  }
}

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
