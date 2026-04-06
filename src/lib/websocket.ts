'use client'

// ---------------------------------------------------------------------------
// WebSocket — useWebSocket hook (connection lifecycle, heartbeat, frame routing)
// Sub-modules handle types, handshake, and event dispatch.
// ---------------------------------------------------------------------------
import { useCallback, useEffect } from 'react'
import { useMissionControl } from '@/store'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'
import { cacheDeviceToken, clearDeviceIdentity } from '@/lib/device-identity'
import { createClientLogger } from '@/lib/client-logger'
import {
  ConnectErrorDetailCodes,
  readErrorDetailCode,
  NON_RETRYABLE_ERROR_CODES,
  shouldRetryWithoutDeviceIdentity,
} from '@/lib/websocket-utils'
import {
  type GatewayFrame,
  PING_INTERVAL_MS,
  MAX_MISSED_PONGS,
  ERROR_LOG_DEDUPE_MS,
} from './websocket-types'
import { buildConnectRequest } from './websocket-handshake'
import { dispatchBroadcastEvent } from './websocket-events'

const log = createClientLogger('WebSocket')

// ---------------------------------------------------------------------------
// Shared singleton state (persists across hook mounts/re-renders)
// ---------------------------------------------------------------------------
const wsRef: { current: WebSocket | null } = { current: null }
const reconnectTimeoutRef: { current: NodeJS.Timeout | undefined } = { current: undefined }
const pingIntervalRef: { current: NodeJS.Timeout | undefined } = { current: undefined }
const reconnectUrl: { current: string } = { current: '' }
const authTokenRef: { current: string } = { current: '' }
const requestIdRef: { current: number } = { current: 0 }
const handshakeCompleteRef: { current: boolean } = { current: false }
const reconnectAttemptsRef: { current: number } = { current: 0 }
const manualDisconnectRef: { current: boolean } = { current: false }
const nonRetryableErrorRef: { current: string | null } = { current: null }
const connectRef: { current: (url: string, token?: string) => void } = { current: () => {} }
const lastWebSocketErrorRef: { current: { message: string; at: number } | null } = { current: null }
const pingCounterRef: { current: number } = { current: 0 }
const pingSentTimestamps: { current: Map<string, number> } = { current: new Map() }
const missedPongsRef: { current: number } = { current: 0 }
const gatewaySupportsPingRef: { current: boolean } = { current: true }
const lastSeqRef: { current: number | null } = { current: null }
const tokenOnlyFallbackRef: { current: boolean } = { current: false }
const tokenOnlyFallbackTriedRef: { current: boolean } = { current: false }

const nextRequestId = (): string => {
  requestIdRef.current += 1
  return `mc-${requestIdRef.current}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket() {
  const maxReconnectAttempts = 10

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
    addExecApproval,
    updateExecApproval,
  } = useMissionControl()

  const isNonRetryableGatewayError = useCallback((message: string, error?: GatewayFrame['error']): boolean => {
    const code = readErrorDetailCode(error)
    if (code && NON_RETRYABLE_ERROR_CODES.has(code)) return true

    const normalized = message.toLowerCase()
    return (
      normalized.includes('origin not allowed') ||
      normalized.includes('device identity required') ||
      normalized.includes('requires device identity') ||
      normalized.includes('secure context') ||
      normalized.includes('device_auth_signature_invalid') ||
      normalized.includes('invalid connect params') ||
      normalized.includes('/client/id') ||
      normalized.includes('auth rate limit') ||
      normalized.includes('rate limited')
    )
  }, [])

  const getGatewayErrorHelp = useCallback((message: string): string => {
    const normalized = message.toLowerCase()
    if (normalized.includes('origin not allowed')) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '<control-ui-origin>'
      return `Gateway rejected browser origin. Add ${origin} to gateway.controlUi.allowedOrigins on the gateway, then reconnect.`
    }
    if (normalized.includes('device identity required') || normalized.includes('requires device identity') || normalized.includes('secure context')) {
      return 'Gateway requires device identity. Open Ultron Mission Control via HTTPS (or localhost), then reconnect so WebCrypto signing can run.'
    }
    if (normalized.includes('device_auth_signature_invalid')) {
      return 'Gateway rejected device signature. Clear local device identity in the browser and reconnect.'
    }
    if (normalized.includes('invalid connect params') || normalized.includes('/client/id')) {
      return 'Gateway rejected client identity params. Ensure NEXT_PUBLIC_GATEWAY_CLIENT_ID is set to openclaw-control-ui and reconnect.'
    }
    if (normalized.includes('auth rate limit') || normalized.includes('rate limited')) {
      return 'Gateway authentication is rate limited. Wait briefly, then reconnect.'
    }
    return 'Gateway handshake failed. Check gateway control UI origin and device identity settings, then reconnect.'
  }, [])

  const startHeartbeat = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)

    pingIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !handshakeCompleteRef.current) return
      if (!gatewaySupportsPingRef.current) return

      if (missedPongsRef.current >= MAX_MISSED_PONGS) {
        log.warn(`Missed ${MAX_MISSED_PONGS} pongs, triggering reconnect`)
        addLog({
          id: `heartbeat-${Date.now()}`,
          timestamp: Date.now(),
          level: 'warn',
          source: 'websocket',
          message: `No heartbeat response after ${MAX_MISSED_PONGS} attempts, reconnecting...`,
        })
        wsRef.current?.close(4000, 'Heartbeat timeout')
        return
      }

      pingCounterRef.current += 1
      const pingId = `ping-${pingCounterRef.current}`

      // Cap map size to prevent unbounded growth if pongs are never received
      if (pingSentTimestamps.current.size >= 10) {
        const oldest = pingSentTimestamps.current.keys().next().value
        if (oldest !== undefined) pingSentTimestamps.current.delete(oldest)
      }

      pingSentTimestamps.current.set(pingId, Date.now())
      missedPongsRef.current += 1

      try {
        wsRef.current.send(JSON.stringify({ type: 'req', method: 'ping', id: pingId }))
      } catch {
        // Send failed; reconnect logic will recover
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

  const handlePong = useCallback((frameId: string) => {
    const sentAt = pingSentTimestamps.current.get(frameId)
    if (sentAt) {
      const rtt = Date.now() - sentAt
      pingSentTimestamps.current.delete(frameId)
      missedPongsRef.current = 0
      setConnection({ latency: rtt })
    }
  }, [setConnection])

  const sendConnectHandshake = useCallback(async (ws: WebSocket, nonce?: string) => {
    const request = await buildConnectRequest({
      nonce,
      authToken: authTokenRef.current,
      tokenOnlyFallback: tokenOnlyFallbackRef.current,
      requestId: nextRequestId(),
    })
    log.info('Sending connect handshake')
    ws.send(JSON.stringify(request))
  }, [])

  const handleGatewayFrame = useCallback((frame: GatewayFrame, ws: WebSocket) => {
    log.debug(`Gateway frame: ${frame.type}`)

    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      log.info('Received connect challenge, sending handshake')
      const challengePayload = frame.payload !== null && typeof frame.payload === 'object' && !Array.isArray(frame.payload)
        ? frame.payload as Record<string, unknown>
        : {}
      sendConnectHandshake(ws, typeof challengePayload['nonce'] === 'string' ? challengePayload['nonce'] : undefined)
      return
    }

    if (frame.type === 'res' && frame.ok && !handshakeCompleteRef.current) {
      log.info('Handshake complete')
      handshakeCompleteRef.current = true
      reconnectAttemptsRef.current = 0
      const resultObj = frame.result !== null && typeof frame.result === 'object' && !Array.isArray(frame.result)
        ? frame.result as Record<string, unknown>
        : {}
      if (typeof resultObj['deviceToken'] === 'string') {
        cacheDeviceToken(resultObj['deviceToken'])
      }
      setConnection({ isConnected: true, lastConnected: new Date(), reconnectAttempts: 0 })
      startHeartbeat()
      return
    }

    // Any response to a ping ID (even an error) proves the connection is alive
    if (frame.type === 'res' && frame.id?.startsWith('ping-')) {
      const rawPingError = frame.error?.message || JSON.stringify(frame.error || '')
      if (!frame.ok && /unknown method:\s*ping/i.test(rawPingError)) {
        gatewaySupportsPingRef.current = false
        missedPongsRef.current = 0
        pingSentTimestamps.current.clear()
        log.info('Gateway ping RPC unavailable; using passive heartbeat mode')
      }
      handlePong(frame.id)
      return
    }

    if (frame.type === 'res' && !frame.ok) {
      log.error(`Gateway error: ${frame.error?.message || JSON.stringify(frame.error)}`)
      const rawMessage = frame.error?.message || JSON.stringify(frame.error)
      const help = getGatewayErrorHelp(rawMessage)
      const shouldFallbackToTokenOnly = shouldRetryWithoutDeviceIdentity(
        rawMessage,
        frame.error,
        Boolean(authTokenRef.current),
        tokenOnlyFallbackTriedRef.current,
      )

      if (shouldFallbackToTokenOnly) {
        tokenOnlyFallbackRef.current = true
        tokenOnlyFallbackTriedRef.current = true
        clearDeviceIdentity()
        addLog({
          id: `gateway-token-only-fallback-${Date.now()}`,
          timestamp: Date.now(),
          level: 'warn',
          source: 'gateway',
          message: 'Gateway rejected cached browser device credentials. Retrying with token-only authentication.',
        })
        stopHeartbeat()
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(4002, 'Retrying with token-only authentication')
        }
        return
      }

      const nonRetryable = isNonRetryableGatewayError(rawMessage, frame.error)
      addLog({
        id: nonRetryable ? `gateway-handshake-${rawMessage}` : `error-${Date.now()}`,
        timestamp: Date.now(),
        level: 'error',
        source: 'gateway',
        message: `Gateway error: ${rawMessage}${nonRetryable ? ` — ${help}` : ''}`,
      })

      if (nonRetryable) {
        nonRetryableErrorRef.current = rawMessage
        addNotification({
          id: Date.now(),
          recipient: 'operator',
          type: 'error',
          title: 'Gateway Handshake Blocked',
          message: help,
          created_at: Math.floor(Date.now() / 1000),
        })
        stopHeartbeat()
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(4001, 'Non-retryable gateway handshake error')
        }
      }
      return
    }

    if (frame.type === 'event') {
      dispatchBroadcastEvent(
        frame,
        { lastSeq: lastSeqRef },
        { setSessions, addLog, addChatMessage, addNotification, updateAgent, addExecApproval, updateExecApproval },
      )
    }
  }, [
    sendConnectHandshake,
    setConnection,
    setSessions,
    addLog,
    startHeartbeat,
    handlePong,
    addChatMessage,
    addNotification,
    updateAgent,
    stopHeartbeat,
    isNonRetryableGatewayError,
    getGatewayErrorHelp,
    addExecApproval,
    updateExecApproval,
  ])

  const normalizeWebSocketUrl = useCallback((rawUrl: string): string => {
    const built = buildGatewayWebSocketUrl({
      host: rawUrl,
      port: Number(process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'),
      browserProtocol: window.location.protocol,
    })
    const parsed = new URL(built, window.location.origin)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '').replace('/?', '?')
  }, [])

  const shouldSuppressWebSocketError = useCallback((message: string): boolean => {
    const now = Date.now()
    const previous = lastWebSocketErrorRef.current
    if (previous && previous.message === message && now - previous.at < ERROR_LOG_DEDUPE_MS) {
      return true
    }
    lastWebSocketErrorRef.current = { message, at: now }
    return false
  }, [])

  const connect = useCallback((url: string, token?: string) => {
    const state = wsRef.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    let urlToken = ''
    try {
      urlToken = new URL(url, window.location.origin).searchParams.get('token') || ''
    } catch { /* ignore malformed url */ }
    authTokenRef.current = token || urlToken || ''

    const normalizedUrl = normalizeWebSocketUrl(url)
    reconnectUrl.current = normalizedUrl
    handshakeCompleteRef.current = false
    manualDisconnectRef.current = false
    nonRetryableErrorRef.current = null
    lastSeqRef.current = null

    try {
      const ws = new WebSocket(normalizedUrl)
      wsRef.current = ws

      ws.onopen = () => {
        log.info(`Connected to ${normalizedUrl}`)
        setConnection({ url: normalizedUrl, reconnectAttempts: 0 })
        log.debug('Waiting for connect challenge')
      }

      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as GatewayFrame
          handleGatewayFrame(frame, ws)
        } catch (error) {
          log.error('Failed to parse WebSocket message:', error)
          addLog({
            id: `raw-${Date.now()}`,
            timestamp: Date.now(),
            level: 'debug',
            source: 'websocket',
            message: `Raw message: ${event.data}`,
          })
        }
      }

      ws.onclose = (event) => {
        log.info(`Disconnected from Gateway: ${event.code} ${event.reason}`)
        setConnection({ isConnected: false })
        handshakeCompleteRef.current = false
        stopHeartbeat()

        if (manualDisconnectRef.current) return
        if (nonRetryableErrorRef.current) {
          setConnection({ reconnectAttempts: 0 })
          return
        }

        // Exponential backoff with jitter
        const attempts = reconnectAttemptsRef.current
        if (attempts < maxReconnectAttempts) {
          const base = Math.min(1000 * Math.pow(1.7, attempts), 15000)
          const timeout = Math.round(base + Math.random() * base * 0.5)
          log.info(`Reconnecting in ${timeout}ms (attempt ${attempts + 1}/${maxReconnectAttempts})`)
          reconnectAttemptsRef.current = attempts + 1
          setConnection({ reconnectAttempts: attempts + 1 })
          reconnectTimeoutRef.current = setTimeout(() => {
            connectRef.current(reconnectUrl.current, authTokenRef.current)
          }, timeout)
        } else {
          log.error('Max reconnection attempts reached')
          addLog({
            id: `error-${Date.now()}`,
            timestamp: Date.now(),
            level: 'error',
            source: 'websocket',
            message: 'Max reconnection attempts reached. Please reconnect manually.',
          })
        }
      }

      ws.onerror = (error) => {
        if (nonRetryableErrorRef.current) return
        log.error('WebSocket error:', error)
        const errorMessage = 'WebSocket error occurred'
        if (!shouldSuppressWebSocketError(errorMessage)) {
          addLog({
            id: `error-${Date.now()}`,
            timestamp: Date.now(),
            level: 'error',
            source: 'websocket',
            message: errorMessage,
          })
        }
      }
    } catch (error) {
      log.error('Failed to connect to WebSocket:', error)
      const errorMessage = 'Failed to initialize WebSocket connection'
      if (!shouldSuppressWebSocketError(errorMessage)) {
        addLog({
          id: `error-${Date.now()}`,
          timestamp: Date.now(),
          level: 'error',
          source: 'websocket',
          message: errorMessage,
        })
      }
      setConnection({ isConnected: false })
    }
  }, [setConnection, handleGatewayFrame, addLog, stopHeartbeat, normalizeWebSocketUrl, shouldSuppressWebSocketError])

  // Keep ref in sync so onclose always calls the latest connect closure
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
    stopHeartbeat()
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect')
      wsRef.current = null
    }
    handshakeCompleteRef.current = false
    setConnection({ isConnected: false, reconnectAttempts: 0, latency: undefined })
  }, [setConnection, stopHeartbeat])

  const sendMessage = useCallback((message: unknown): boolean => {
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

  return {
    isConnected: connection.isConnected,
    connectionState: connection,
    connect,
    disconnect,
    reconnect,
    sendMessage,
  }
}
