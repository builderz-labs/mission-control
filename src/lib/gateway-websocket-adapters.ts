'use client'

import {
  getOrCreateDeviceIdentity,
  signPayload,
  getCachedDeviceToken,
  cacheDeviceToken,
} from '@/lib/device-identity'
import { APP_VERSION } from '@/lib/version'

const PROTOCOL_VERSION = 3
const PING_INTERVAL_MS = 30_000
const MAX_MISSED_PONGS = 3

export interface GatewayFrame {
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

export interface GatewayMessage {
  type: 'session_update' | 'log' | 'event' | 'status' | 'spawn_result' | 'cron_status' | 'pong'
  data: any
  timestamp?: number
}

export interface AdapterHealth {
  status: 'online' | 'offline' | 'degraded'
  latency?: number
  details?: string
}

export interface GatewayAdapter {
  readonly name: string
  connect(url: string, token?: string): void
  disconnect(code?: number, reason?: string): void
  send(payload: unknown): boolean
  onFrame(handler: (frame: GatewayFrame) => void): void
  onMessage(handler: (message: GatewayMessage) => void): void
  onHeartbeat(handler: (latency: number) => void): void
  onOpen(handler: () => void): void
  onClose(handler: (event: CloseEvent) => void): void
  onError(handler: (error: Event) => void): void
  health(): AdapterHealth
}

export class OpenClawWebSocketAdapter implements GatewayAdapter {
  readonly name: string
  private ws: WebSocket | null = null
  private requestId = 0
  private handshakeComplete = false
  private pingInterval: NodeJS.Timeout | undefined
  private pingCounter = 0
  private pingTimestamps = new Map<string, number>()
  private missedPongs = 0
  private authToken = ''

  private frameHandlers = new Set<(frame: GatewayFrame) => void>()
  private messageHandlers = new Set<(message: GatewayMessage) => void>()
  private heartbeatHandlers = new Set<(latency: number) => void>()
  private openHandlers = new Set<() => void>()
  private closeHandlers = new Set<(event: CloseEvent) => void>()
  private errorHandlers = new Set<(error: Event) => void>()

  constructor(name = 'openclaw') {
    this.name = name
  }

  connect(url: string, token?: string) {
    const state = this.ws?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    const urlObj = new URL(url, window.location.origin)
    const urlToken = urlObj.searchParams.get('token')
    this.authToken = token || urlToken || ''
    urlObj.searchParams.delete('token')

    const ws = new WebSocket(urlObj.toString())
    this.ws = ws
    this.handshakeComplete = false
    this.missedPongs = 0

    ws.onopen = () => {
      this.openHandlers.forEach(handler => handler())
    }

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as GatewayFrame
        this.frameHandlers.forEach(handler => handler(frame))
        this.handleFrame(frame)
      } catch {
        // ignore malformed non-protocol messages
      }
    }

    ws.onerror = (error) => {
      this.errorHandlers.forEach(handler => handler(error))
    }

    ws.onclose = (event) => {
      this.stopHeartbeat()
      this.handshakeComplete = false
      this.closeHandlers.forEach(handler => handler(event))
    }
  }

  disconnect(code = 1000, reason = 'Manual disconnect') {
    this.stopHeartbeat()
    this.handshakeComplete = false
    if (this.ws) {
      this.ws.close(code, reason)
      this.ws = null
    }
  }

  send(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.handshakeComplete) return false
    this.ws.send(JSON.stringify(payload))
    return true
  }

  onFrame(handler: (frame: GatewayFrame) => void) { this.frameHandlers.add(handler) }
  onMessage(handler: (message: GatewayMessage) => void) { this.messageHandlers.add(handler) }
  onHeartbeat(handler: (latency: number) => void) { this.heartbeatHandlers.add(handler) }
  onOpen(handler: () => void) { this.openHandlers.add(handler) }
  onClose(handler: (event: CloseEvent) => void) { this.closeHandlers.add(handler) }
  onError(handler: (error: Event) => void) { this.errorHandlers.add(handler) }

  health(): AdapterHealth {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return { status: 'offline' }
    if (!this.handshakeComplete) return { status: 'degraded', details: 'Handshake pending' }
    return { status: 'online' }
  }

  private nextRequestId() {
    this.requestId += 1
    return `mc-${this.requestId}`
  }

  private async sendHandshake(nonce?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    let device: {
      id: string
      publicKey: string
      signature: string
      signedAt: number
      nonce: string
    } | undefined

    const cachedToken = getCachedDeviceToken()
    const clientId = 'gateway-client'
    const clientMode = 'ui'
    const role = 'operator'
    const scopes = ['operator.admin']
    const authToken = this.authToken || undefined
    const tokenForSignature = authToken ?? cachedToken ?? ''

    if (nonce) {
      try {
        const identity = await getOrCreateDeviceIdentity()
        const signedAt = Date.now()
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
      } catch {
        // continue without device identity
      }
    }

    const connectRequest = {
      type: 'req',
      method: 'connect',
      id: this.nextRequestId(),
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: 'Mission Control',
          version: APP_VERSION,
          platform: 'web',
          mode: clientMode,
          instanceId: `mc-${Date.now()}`,
        },
        role,
        scopes,
        auth: authToken ? { token: authToken } : undefined,
        device,
        deviceToken: cachedToken || undefined,
      },
    }

    this.ws.send(JSON.stringify(connectRequest))
  }

  private startHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval)

    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.handshakeComplete) return
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        this.disconnect(4000, 'Heartbeat timeout')
        return
      }

      this.pingCounter += 1
      const pingId = `ping-${this.pingCounter}`
      this.missedPongs += 1
      this.pingTimestamps.set(pingId, Date.now())
      this.ws.send(JSON.stringify({ type: 'req', method: 'ping', id: pingId }))
    }, PING_INTERVAL_MS)
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = undefined
    }
    this.missedPongs = 0
    this.pingTimestamps.clear()
  }

  private handleFrame(frame: GatewayFrame) {
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      this.sendHandshake(frame.payload?.nonce)
      return
    }

    if (frame.type === 'res' && frame.ok && !this.handshakeComplete) {
      this.handshakeComplete = true
      if (frame.result?.deviceToken) cacheDeviceToken(frame.result.deviceToken)
      this.heartbeatHandlers.forEach(handler => handler(0))
      this.startHeartbeat()
      return
    }

    if (frame.type === 'res' && frame.id?.startsWith('ping-')) {
      const sentAt = this.pingTimestamps.get(frame.id)
      if (sentAt) {
        const rtt = Date.now() - sentAt
        this.pingTimestamps.delete(frame.id)
        this.missedPongs = 0
        this.heartbeatHandlers.forEach(handler => handler(rtt))
      }
      return
    }

    if (frame.type === 'event') {
      const msgType = frame.event === 'tick'
        ? 'session_update'
        : frame.event === 'log'
          ? 'log'
          : 'event'
      this.messageHandlers.forEach(handler => handler({ type: msgType, data: frame.payload, timestamp: Date.now() }))
    }
  }
}

export function createGatewayAdapter(kind: string, name?: string): GatewayAdapter {
  if (kind === 'openclaw' || kind === 'stub' || kind === 'custom') {
    return new OpenClawWebSocketAdapter(name || kind)
  }
  return new OpenClawWebSocketAdapter(name || 'openclaw')
}
