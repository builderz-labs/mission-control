'use client'

import { ReconnectStrategy } from './reconnect'
import type { GatewayFrame, GatewayState, GatewayEvent, GatewayConfig, QueuedMessage } from './types'
import { DEFAULT_CONFIG, PROTOCOL_VERSION } from './types'

type Listener = (data: any) => void

/** Structured error emitted by GatewayClient */
export interface GatewayError {
    code: string
    level: 'error' | 'warn' | 'info'
    message: string
    details?: unknown
}

function formatFrameError(error: unknown): string {
    if (!error) return 'Unknown error'
    if (typeof error === 'string') return error
    if (typeof error === 'object') {
        const e = error as Record<string, unknown>
        return e.message as string || e.reason as string || e.code as string || JSON.stringify(error)
    }
    return String(error)
}

export class GatewayClient {
    private static instance: GatewayClient | null = null

    private ws: WebSocket | null = null
    private _state: GatewayState = 'idle'
    private reconnectStrategy: ReconnectStrategy
    private config: GatewayConfig
    private queue: QueuedMessage[] = []
    private listeners = new Map<string, Set<Listener>>()
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null
    private missedPongs = 0
    private pingCounter = 0
    private pingSentAt = new Map<string, number>()
    private requestCounter = 0
    private handshakeComplete = false
    private token = ''
    private url = ''

    private constructor(config?: Partial<GatewayConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.reconnectStrategy = new ReconnectStrategy(
            this.config.maxReconnectAttempts,
        )
    }

    static get(config?: Partial<GatewayConfig>): GatewayClient {
        if (!GatewayClient.instance) {
            GatewayClient.instance = new GatewayClient(config)
        }
        return GatewayClient.instance
    }

    static reset(): void {
        GatewayClient.instance?.disconnect()
        GatewayClient.instance = null
    }

    get state(): GatewayState {
        return this._state
    }

    get connected(): boolean {
        return this._state === 'connected'
    }

    get reconnectAttempts(): number {
        return this.reconnectStrategy.currentAttempts
    }

    connect(url: string, token?: string): void {
        if (this._state === 'connected' || this._state === 'connecting' || this._state === 'handshaking') return
        this.url = url.split('?')[0]
        this.token = token ?? ''
        this.handshakeComplete = false
        this.reconnectStrategy.reset()
        this.transition('connecting')
        this.createWebSocket()
    }

    disconnect(): void {
        this.reconnectStrategy.stop()
        this.stopHeartbeat()
        if (this.ws) {
            this.ws.onclose = null
            this.ws.close(1000, 'Manual disconnect')
            this.ws = null
        }
        this.handshakeComplete = false
        this.transition('idle')
    }

    reconnect(): void {
        this.disconnect()
        if (this.url) {
            setTimeout(() => {
                this.reconnectStrategy.reset()
                this.connect(this.url, this.token)
            }, 500)
        }
    }

    send(data: unknown): boolean {
        if (this._state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
            return true
        }
        this.queue.push({ data, timestamp: Date.now() })
        if (this.queue.length > 100) this.queue.shift()
        return false
    }

    on(event: GatewayEvent | string, fn: Listener): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set())
        this.listeners.get(event)!.add(fn)
        return () => { this.listeners.get(event)?.delete(fn) }
    }

    private createWebSocket(): void {
        try {
            const ws = new WebSocket(this.url)
            this.ws = ws

            ws.onopen = () => {
                this.transition('handshaking')
            }

            ws.onmessage = (event) => {
                try {
                    const frame = JSON.parse(event.data) as GatewayFrame
                    this.handleFrame(frame)
                } catch {
                    this.emitError('PARSE_ERROR', 'warn', 'Failed to parse gateway message')
                }
            }

            ws.onclose = (event) => {
                this.stopHeartbeat()
                this.handshakeComplete = false
                this.transition('disconnected')
                this.emit('close', { code: event.code, reason: event.reason })

                const scheduled = this.reconnectStrategy.scheduleNext(() => {
                    this.emit('reconnecting', { attempt: this.reconnectStrategy.currentAttempts })
                    this.createWebSocket()
                    this.transition('connecting')
                })

                if (!scheduled && this.reconnectStrategy.isExhausted) {
                    this.emitError('MAX_RECONNECT', 'error', `Reconnection failed after ${this.reconnectStrategy.currentAttempts} attempts`)
                }
            }

            ws.onerror = () => {
                this.emitError('WS_ERROR', 'warn', 'WebSocket connection error')
            }
        } catch {
            this.transition('disconnected')
            this.emitError('CONNECT_FAILED', 'error', 'Failed to create WebSocket connection')
        }
    }

    private handleFrame(frame: GatewayFrame): void {
        if (frame.type === 'event' && frame.event === 'connect.challenge') {
            this.sendHandshake(frame.payload?.nonce)
            return
        }

        if (frame.type === 'res' && frame.ok && !this.handshakeComplete) {
            this.handshakeComplete = true
            this.reconnectStrategy.reset()
            this.transition('connected')
            this.startHeartbeat()
            this.flushQueue()
            return
        }

        if (frame.type === 'res' && frame.id?.startsWith('ping-')) {
            this.handlePong(frame.id)
            return
        }

        if (frame.type === 'res' && !frame.ok) {
            const detail = formatFrameError(frame.error)

            if (!this.handshakeComplete) {
                this.emitError('HANDSHAKE_FAILED', 'error', `Handshake rejected: ${detail}`, frame.error)
                this.reconnectStrategy.stop()
                this.ws?.close(4001, 'Handshake failed')
            } else {
                this.emitError('GATEWAY_ERROR', 'warn', `Gateway: ${detail}`, frame.error)
            }
            return
        }

        if (frame.type === 'event' && frame.event) {
            this.routeEvent(frame.event, frame.payload)
        }
    }

    private routeEvent(event: string, payload: any): void {
        this.emit(event, payload)
    }

    private sendHandshake(nonce?: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const handshake = {
            type: 'req',
            method: 'connect',
            id: this.nextRequestId(),
            params: {
                minProtocol: PROTOCOL_VERSION,
                maxProtocol: PROTOCOL_VERSION,
                client: {
                    id: 'gateway-client',
                    displayName: 'Mission Control',
                    version: '2.0.0',
                    platform: 'web',
                    mode: 'ui',
                    instanceId: `mc-${Date.now()}`,
                },
                role: 'operator',
                scopes: ['operator.admin'],
                auth: this.token ? { token: this.token } : undefined,
            },
        }

        this.ws.send(JSON.stringify(handshake))
    }

    private startHeartbeat(): void {
        this.stopHeartbeat()
        this.missedPongs = 0

        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.handshakeComplete) return

            if (this.missedPongs >= this.config.maxMissedPongs) {
                this.emitError('HEARTBEAT_TIMEOUT', 'warn', `No heartbeat after ${this.config.maxMissedPongs} pings, reconnecting`)
                this.ws?.close(4000, 'Heartbeat timeout')
                return
            }

            this.pingCounter++
            const pingId = `ping-${this.pingCounter}`
            this.pingSentAt.set(pingId, Date.now())
            this.missedPongs++

            try {
                this.ws.send(JSON.stringify({ type: 'req', method: 'ping', id: pingId }))
            } catch {
            }
        }, this.config.pingIntervalMs)
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
        this.missedPongs = 0
        this.pingSentAt.clear()
    }

    private handlePong(id: string): void {
        const sentAt = this.pingSentAt.get(id)
        if (sentAt) {
            const rtt = Date.now() - sentAt
            this.pingSentAt.delete(id)
            this.missedPongs = 0
            this.emit('latency', rtt)
        }
    }

    private transition(next: GatewayState): void {
        const prev = this._state
        this._state = next
        this.emit('state', { state: next, prev })
    }

    private emit(event: string, data?: unknown): void {
        this.listeners.get(event)?.forEach((fn) => {
            try { fn(data) } catch (e) { console.error(`[GatewayClient] listener error on "${event}":`, e) }
        })
    }

    private emitError(code: string, level: GatewayError['level'], message: string, details?: unknown): void {
        this.emit('error', { code, level, message, details } satisfies GatewayError)
    }

    private flushQueue(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
        const pending = this.queue.splice(0)
        for (const { data } of pending) {
            try { this.ws.send(JSON.stringify(data)) } catch { break }
        }
    }

    private nextRequestId(): string {
        this.requestCounter++
        return `mc-${this.requestCounter}`
    }
}
