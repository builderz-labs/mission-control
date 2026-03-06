/**
 * Server-side gateway proxy manager.
 *
 * Maintains a singleton WebSocket connection from the Next.js server process
 * to the OpenClaw gateway and exposes:
 *  - callMethod()   – one-shot request/response (used by POST /api/gateway-proxy)
 *  - EventEmitter   – gateway_event broadcasts (used by GET /api/gateway-proxy/stream)
 *
 * Only active when GATEWAY_PROXY_MODE=1.  All access is gated by an allowlist
 * so the proxy cannot be used to call arbitrary gateway methods.
 */

import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { config } from './config'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Gateway methods the proxy will forward.  Any method not in this set is
 * rejected with a 403 before touching the network.
 */
export const ALLOWED_GATEWAY_METHODS = new Set([
  'ping',
  'status',
  'models.list',
  'sessions.list',
  'sessions.send',
  'sessions.spawn',
])

/**
 * Methods in the allowlist that additionally require the operator role
 * (viewer-only callers are rejected).
 */
export const OPERATOR_GATEWAY_METHODS = new Set([
  'sessions.send',
  'sessions.spawn',
])

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = 2_000
const RECONNECT_MAX_MS = 30_000
const CALL_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the WebSocket URL for the server → gateway connection.
 *
 * - Uses `wss://` when `OPENCLAW_GATEWAY_PROTOCOL` is set to `wss` or `https`,
 *   or when the gateway host is not a local/loopback address.
 * - Defaults to `ws://` for loopback/localhost hosts.
 *
 * IMPORTANT: Do NOT set OPENCLAW_GATEWAY_HOST to `0.0.0.0`.  That address
 * is a bind wildcard — it is valid for `listen()` but not for outbound
 * connections.  Use `127.0.0.1` (or the specific interface IP) instead.
 */
function buildGatewayWsUrl(host: string, port: number): string {
  const explicitProtocol = process.env.OPENCLAW_GATEWAY_PROTOCOL || ''
  if (explicitProtocol === 'wss' || explicitProtocol === 'https') {
    return `wss://${host}:${port}`
  }
  const isLocal =
    host === '127.0.0.1' ||
    host === '::1' ||
    host.toLowerCase() === 'localhost' ||
    host.toLowerCase().endsWith('.local')
  const protocol = isLocal ? 'ws' : 'wss'
  return `${protocol}://${host}:${port}`
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

// ---------------------------------------------------------------------------
// Manager class
// ---------------------------------------------------------------------------

class GatewayProxyManager extends EventEmitter {
  private ws: WebSocket | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private requestCounter = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private _stopping = false

  connect(): void {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return
    }

    this._stopping = false
    const url = buildGatewayWsUrl(config.gatewayHost, config.gatewayPort)
    logger.info({ url }, '[gateway-proxy] Connecting to gateway')

    const ws = new WebSocket(url)
    this.ws = ws

    ws.on('open', () => {
      logger.info('[gateway-proxy] Connected to gateway')
      this.reconnectAttempts = 0
      this.emit('connected')
    })

    ws.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>
        this._handleFrame(frame)
      } catch (err) {
        logger.warn({ err }, '[gateway-proxy] Failed to parse gateway frame')
      }
    })

    ws.on('close', (code, reason) => {
      logger.info(
        { code, reason: reason.toString() },
        '[gateway-proxy] Gateway disconnected',
      )
      this.ws = null
      this.emit('disconnected')

      // Fail all in-flight requests immediately
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timer)
        req.reject(new Error('Gateway disconnected'))
        this.pendingRequests.delete(id)
      }

      if (!this._stopping) {
        this._scheduleReconnect()
      }
    })

    ws.on('error', (err) => {
      logger.warn({ err }, '[gateway-proxy] Gateway WebSocket error')
      this.emit('error', err)
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    )
    this.reconnectAttempts += 1
    logger.info(
      { delay, attempts: this.reconnectAttempts },
      '[gateway-proxy] Scheduling reconnect',
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private _handleFrame(frame: Record<string, unknown>): void {
    // Response to a pending call
    if (
      frame.type === 'res' &&
      typeof frame.id === 'string' &&
      this.pendingRequests.has(frame.id)
    ) {
      const req = this.pendingRequests.get(frame.id)!
      clearTimeout(req.timer)
      this.pendingRequests.delete(frame.id)

      if (frame.ok === false) {
        const errMsg =
          typeof (frame.error as any)?.message === 'string'
            ? (frame.error as any).message
            : 'Gateway error'
        req.reject(new Error(errMsg))
      } else {
        req.resolve(frame.result)
      }
      return
    }

    // Broadcast all event / status / pong frames to SSE subscribers
    if (
      frame.type === 'event' ||
      frame.type === 'status' ||
      frame.type === 'pong'
    ) {
      this.emit('gateway_event', frame)
    }
  }

  /**
   * Send a request to the gateway and await the response.
   *
   * Rejects if:
   *  - the method is not in ALLOWED_GATEWAY_METHODS
   *  - the gateway is not currently connected
   *  - the call times out
   */
  callMethod(
    method: string,
    params?: unknown,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!ALLOWED_GATEWAY_METHODS.has(method)) {
      return Promise.reject(new Error(`Method not allowed: ${method}`))
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Gateway not connected'))
    }

    const id = `proxy-${(++this.requestCounter).toString()}`
    const frame = { type: 'req', method, id, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Gateway call timed out: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })

      try {
        this.ws!.send(JSON.stringify(frame))
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  stop(): void {
    this._stopping = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _instance: GatewayProxyManager | null = null

/**
 * Returns (and lazily creates) the singleton GatewayProxyManager.
 *
 * On first call, automatically starts the connection to the gateway and
 * emits a startup log so deployment issues are visible immediately.
 *
 * Callers should check config.gatewayProxyMode before using this.
 */
export function getGatewayProxyManager(): GatewayProxyManager {
  if (!_instance) {
    _instance = new GatewayProxyManager()
    // Eagerly start the connection on first access so health problems are
    // surfaced at startup rather than only when the first request arrives.
    logger.info(
      { host: config.gatewayHost, port: config.gatewayPort },
      '[gateway-proxy] Proxy mode active — initiating gateway connection',
    )
    _instance.connect()
  }
  return _instance
}
