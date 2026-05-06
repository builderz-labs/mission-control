'use client'

import { useCallback, useEffect } from 'react'
import { useMissionControl } from '@/store'
import { normalizeModel } from '@/lib/utils'
import { buildGatewayPathFallbackUrls, buildGatewayWebSocketUrl } from '@/lib/gateway-url'
import {
  getOrCreateDeviceIdentity,
  signPayload,
  getCachedDeviceToken,
  cacheDeviceToken,
  clearDeviceIdentity,
} from '@/lib/device-identity'
import { APP_VERSION } from '@/lib/version'
import { createClientLogger } from '@/lib/client-logger'
import {
  ConnectErrorDetailCodes,
  readErrorDetailCode,
  NON_RETRYABLE_ERROR_CODES,
  shouldRetryWithoutDeviceIdentity,
} from '@/lib/websocket-utils'

const log = createClientLogger('WebSocket')

// Gateway protocol version (v3 required by OpenClaw 2026.x)
const PROTOCOL_VERSION = 3
const DEFAULT_GATEWAY_CLIENT_ID = process.env.NEXT_PUBLIC_GATEWAY_CLIENT_ID || 'openclaw-control-ui'

// Heartbeat configuration
const PING_INTERVAL_MS = 30_000
const MAX_MISSED_PONGS = 3
const ERROR_LOG_DEDUPE_MS = 5_000

// Gateway message types
interface GatewayFrame {
  type: 'event' | 'req' | 'res'
  event?: string
  method?: string
  id?: string
  payload?: any
  ok?: boolean
  result?: any
  error?: { message?: string; code?: string; details?: any; [key: string]: any }
  params?: any
  seq?: number
}

interface GatewayMessage {
  type: 'session_update' | 'log' | 'event' | 'status' | 'spawn_result' | 'cron_status' | 'pong'
  data: any
  timestamp?: number
}

// Shared websocket singleton state across hook mounts.
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
const wsPathFallbackTriedRef: { current: Set<string> } = { current: new Set() }

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
    // Prefer structured error code when available (newer gateways)
    const code = readErrorDetailCode(error)
    if (code && NON_RETRYABLE_ERROR_CODES.has(code)) return true

    // Fallback: string matching for older gateways without structured codes
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
    if (
      normalized.includes('device identity required') ||
      normalized.includes('requires device identity') ||
      normalized.includes('secure context')
    ) {
      return 'Gateway requires device identity. Open Mission Control via HTTPS (or localhost), then reconnect so WebCrypto signing can run.'
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
      if (!gatewaySupportsPingRef.current) return

      // Check missed pongs
      if (missedPongsRef.current >= MAX_MISSED_PONGS) {
        log.warn(`Missed ${MAX_MISSED_PONGS} pongs, triggering reconnect`)
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

      // Cap map size to prevent unbounded growth if pongs are never received
      if (pingSentTimestamps.current.size >= 10) {
        const oldest = pingSentTimestamps.current.keys().next().value
        if (oldest !== undefined) pingSentTimestamps.current.delete(oldest)
      }

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

  // Send the connect handshake (async for Ed25519 device identity signing)
  const sendConnectHandshake = useCallback(async (ws: WebSocket, nonce?: string) => {
    let device: {
      id: string
      publicKey: string
      signature: string
      signedAt: number
      nonce: string
    } | undefined

    const cachedToken = getCachedDeviceToken()

    const clientId = DEFAULT_GATEWAY_CLIENT_ID
    const clientMode = 'ui'
    const role = 'operator'
    const scopes = ['operator.admin']
    const authToken = authTokenRef.current || undefined
    const tokenForSignature = authToken ?? cachedToken ?? ''

    if (nonce && !tokenOnlyFallbackRef.current) {
      try {
        const identity = await getOrCreateDeviceIdentity()
        const signedAt = Date.now()
        // Sign OpenClaw v2 device-auth payload (gateway accepts v2 and v3).
        const payload = [
          'v2',
          identity.deviceId,
          clientId,
          clientMode,
          role,
          scopes.join(','),
          String(signedAt),
          tokenForSignature,
          nonce,
        ].join('|')

        const { signature } = await signPayload(identity.privateKey, payload, signedAt)
        device = {
          id: identity.deviceId,
          publicKey: identity.publicKeyBase64,
          signature,
          signedAt,
          nonce,
        }
      } catch (err) {
        log.warn('Device identity unavailable, proceeding without:', err)
      }
    }

    const connectRequest = {
      type: 'req',
      method: 'connect',
      id: nextRequestId(),
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: 'Mission Control',
          version: APP_VERSION,
          platform: 'web',
          mode: clientMode,
          instanceId: `mc-${Date.now()}`
        },
        role,
        scopes,
        caps: ['tool-events'],
        auth: authToken ? { token: authToken } : undefined,
        device,
        deviceToken: tokenOnlyFallbackRef.current ? undefined : (cachedToken || undefined),
      }
    }
    log.info('Sending connect handshake')
    ws.send(JSON.stringify(connectRequest))
  }, [])

  // Parse and handle different gateway message types
  const handleGatewayMessage = useCallback((message: GatewayMessage) => {
    setLastMessage(message)

    // Debug logging for development
    if (process.env.NODE_ENV === 'development') {
      log.debug(`Message received: ${message.type}`)
    }

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
            model: normalizeModel(message.data.model),
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
        log.warn(`Unknown gateway message type: ${message.type}`)
    }
  }, [setLastMessage, setSessions, addLog, updateSpawnRequest, setCronJobs, addTokenUsage])

  // Handle gateway protocol frames
  const handleGatewayFrame = useCallback((frame: GatewayFrame, ws: WebSocket) => {
    log.debug(`Gateway frame: ${frame.type}`)

    // Handle connect challenge
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      log.info('Received connect challenge, sending handshake')
      sendConnectHandshake(ws, frame.payload?.nonce)
      return
    }

    // Handle connect response (handshake success)
    if (frame.type === 'res' && frame.ok && !handshakeCompleteRef.current) {
      log.info('Handshake complete')
      handshakeCompleteRef.current = true
      reconnectAttemptsRef.current = 0
      // Cache device token if returned by gateway
      if (frame.result?.deviceToken) {
        cacheDeviceToken(frame.result.deviceToken)
      }
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

    // Handle connect error
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
        message: `Gateway error: ${rawMessage}${nonRetryable ? ` — ${help}` : ''}`
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

        // Stop futile reconnect loops for config/auth errors.
        stopHeartbeat()
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(4001, 'Non-retryable gateway handshake error')
        }
      }
      return
    }

    // Handle broadcast events (tick, log, chat, notification, agent status, etc.)
    if (frame.type === 'event') {
      // Track event sequence numbers to detect gaps (missed events)
      const seq = typeof frame.seq === 'number' ? frame.seq : null
      if (seq !== null) {
        if (lastSeqRef.current !== null && seq > lastSeqRef.current + 1) {
          log.warn(`Event sequence gap: expected ${lastSeqRef.current + 1}, received ${seq}`)
        }
        lastSeqRef.current = seq
      }
      if (frame.event === 'tick') {
        // Tick event contains snapshot data
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
      } else if (frame.event === 'tool.stream') {
        // Tool call stream — render as inline tool_call message in chat
        const t = frame.payload
        if (t) {
          addChatMessage({
            id: t.id || -(Date.now() + Math.random()),
            conversation_id: t.conversation_id || t.sessionId || 'tool-stream',
            from_agent: t.agentName || t.agent || 'agent',
            to_agent: null,
            content: '',
            message_type: 'tool_call',
            metadata: {
              toolName: t.toolName || t.name,
              toolArgs: t.args || t.toolArgs,
              toolOutput: t.output || t.toolOutput,
              toolStatus: t.status || 'success',
              durationMs: t.durationMs,
            },
            created_at: t.timestamp ? Math.floor(t.timestamp / 1000) : Math.floor(Date.now() / 1000),
          })
        }
      } else if (frame.event === 'context.compaction') {
        // Context compaction progress toast
        addNotification({
          id: Date.now(),
          recipient: 'operator',
          type: 'info',
          title: 'Context Compaction',
          message: frame.payload?.message || `Session context compacted (${frame.payload?.percentage || '?'}% reduced)`,
          created_at: Math.floor(Date.now() / 1000),
        })
      } else if (frame.event === 'model.fallback') {
        // Model fallback toast
        addNotification({
          id: Date.now(),
          recipient: 'operator',
          type: 'warning',
          title: 'Model Fallback',
          message: frame.payload?.message || `Fell back from ${frame.payload?.from || '?'} to ${frame.payload?.to || '?'}`,
          created_at: Math.floor(Date.now() / 1000),
        })
      } else if (frame.event === 'exec.approval' || frame.event === 'exec.approval.requested') {
        // Exec approval request from gateway (supports both event name variants)
        const a = frame.payload
        const request = a?.request || a // reference UI nests under .request
        if (a?.id) {
          addExecApproval({
            id: a.id,
            sessionId: request?.sessionKey || a.sessionId || '',
            agentName: request?.agentId || a.agentName,
            toolName: a.toolName || a.name || request?.command || 'unknown',
            toolArgs: a.args || a.toolArgs || {},
            command: request?.command || a.command,
            cwd: request?.cwd || a.cwd,
            host: request?.host || a.host,
            resolvedPath: request?.resolvedPath || a.resolvedPath,
            risk: a.risk || 'medium',
            createdAt: a.createdAtMs || a.createdAt || Date.now(),
            expiresAt: a.expiresAtMs || a.expiresAt,
            status: 'pending',
          })
          addNotification({
            id: Date.now(),
            recipient: 'operator',
            type: 'warning',
            title: 'Exec Approval Required',
            message: `${request?.agentId || a.agentName || 'Agent'} wants to run: ${request?.command || a.toolName || a.name || 'tool'}`,
            created_at: Math.floor(Date.now() / 1000),
          })
        }
      } else if (frame.event === 'exec.approval.resolved') {
        // Approval was resolved (by another client or auto-expired)
        const resolved = frame.payload
        if (resolved?.id) {
          const newStatus = resolved.decision === 'deny' ? 'denied' : 'approved'
          updateExecApproval(resolved.id, { status: newStatus as any })
        }
      }
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
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
      return // Already connected or connecting
    }

    let urlToken = ''
    try {
      const parsedInput = new URL(url, window.location.origin)
      urlToken = parsedInput.searchParams.get('token') || ''
    } catch {
      urlToken = ''
    }
    authTokenRef.current = token || urlToken || ''

    const normalizedUrl = normalizeWebSocketUrl(url)
    if (reconnectUrl.current !== normalizedUrl) {
      wsPathFallbackTriedRef.current.clear()
    }
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
        // Don't set isConnected yet - wait for handshake
        setConnection({
          url: normalizedUrl,
          reconnectAttempts: 0
        })
        // Wait for connect.challenge from server
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
            message: `Raw message: ${event.data}`
          })
        }
      }

      ws.onclose = (event) => {
        log.info(`Disconnected from Gateway: ${event.code} ${event.reason}`)
        setConnection({ isConnected: false })
        handshakeCompleteRef.current = false
        stopHeartbeat()

        // Skip auto-reconnect if this was a manual disconnect
        if (manualDisconnectRef.current) return

        // If the initial handshake never completed and the URL is root-only,
        // try common reverse-proxy websocket paths before exponential backoff.
        if (!handshakeCompleteRef.current) {
          const fallback = buildGatewayPathFallbackUrls(normalizedUrl).find(
            (candidate) => !wsPathFallbackTriedRef.current.has(candidate),
          )
          if (fallback) {
            wsPathFallbackTriedRef.current.add(fallback)
            reconnectUrl.current = fallback
            addLog({
              id: `gateway-path-fallback-${Date.now()}`,
              timestamp: Date.now(),
              level: 'warn',
              source: 'websocket',
              message: `Handshake failed on root path. Retrying WebSocket via ${new URL(fallback).pathname}.`,
            })
            reconnectTimeoutRef.current = setTimeout(() => {
              connectRef.current(fallback, authTokenRef.current)
            }, 250)
            return
          }
        }

        // Skip auto-reconnect for non-retryable handshake failures
        if (nonRetryableErrorRef.current) {
          setConnection({ reconnectAttempts: 0 })
          return
        }

        // Gateway optional: don't retry — standalone mode is intentional
        if (process.env.NEXT_PUBLIC_GATEWAY_OPTIONAL === 'true') {
          log.info('Gateway optional — skipping reconnect')
          setConnection({ reconnectAttempts: 0 })
          return
        }

        // Auto-reconnect with exponential backoff (uses connectRef to avoid stale closure)
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
            message: 'Max reconnection attempts reached. Please reconnect manually.'
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
            message: errorMessage
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
          message: errorMessage
        })
      }
      setConnection({ isConnected: false })
    }
  }, [setConnection, handleGatewayFrame, addLog, stopHeartbeat, normalizeWebSocketUrl, shouldSuppressWebSocketError])

  // Keep ref in sync so onclose always calls the latest version of connect
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    // Signal manual disconnect before closing so onclose skips auto-reconnect
    manualDisconnectRef.current = true
    reconnectAttemptsRef.current = 0
    wsPathFallbackTriedRef.current.clear()

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
