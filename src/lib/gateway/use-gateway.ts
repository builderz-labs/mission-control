'use client'

import { useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { GatewayClient } from './client'

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

export function useGateway() {
    const {
        setConnection,
        setSessions,
        addLog,
        addTokenUsage,
        addChatMessage,
        addNotification,
        updateAgent,
    } = useMissionControl()

    const client = GatewayClient.get()

    useEffect(() => {
        const unsubs = [
            client.on('state', ({ state }: { state: string; prev: string }) => {
                setConnection({
                    isConnected: state === 'connected',
                    reconnectAttempts: client.reconnectAttempts,
                    ...(state === 'connected' ? { lastConnected: new Date() } : {}),
                })
            }),

            client.on('latency', (rtt: number) => {
                setConnection({ latency: rtt })
            }),

            client.on('reconnecting', ({ attempt }: { attempt: number }) => {
                setConnection({ reconnectAttempts: attempt })
            }),

            client.on('error', (data: { code: string; level: string; message: string }) => {
                addLog({
                    id: `gw-${data.code}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    timestamp: Date.now(),
                    level: (data.level || 'error') as 'error' | 'warn' | 'info' | 'debug',
                    source: 'gateway',
                    message: `[${data.code}] ${data.message}`,
                })
            }),

            client.on('tick', (payload: any) => {
                const snapshot = payload?.snapshot
                if (snapshot?.sessions) {
                    const mapped = snapshot.sessions.map((session: any, index: number) => ({
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
                        cost: session.cost,
                    }))
                    setSessions(mapped)
                }
            }),

            client.on('log', (payload: any) => {
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
            }),

            client.on('chat.message', (payload: any) => {
                if (payload) {
                    addChatMessage({
                        id: payload.id,
                        conversation_id: payload.conversation_id,
                        from_agent: payload.from_agent,
                        to_agent: payload.to_agent,
                        content: payload.content,
                        message_type: payload.message_type || 'text',
                        metadata: payload.metadata,
                        read_at: payload.read_at,
                        created_at: payload.created_at || Math.floor(Date.now() / 1000),
                    })
                }
            }),

            client.on('notification', (payload: any) => {
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
            }),

            client.on('agent.status', (payload: any) => {
                if (payload?.id) {
                    updateAgent(payload.id, {
                        status: payload.status,
                        last_seen: payload.last_seen,
                        last_activity: payload.last_activity,
                    })
                }
            }),

            client.on('token_usage', (payload: any) => {
                if (payload) {
                    addTokenUsage({
                        model: payload.model,
                        sessionId: payload.sessionId,
                        date: new Date().toISOString(),
                        inputTokens: payload.inputTokens || 0,
                        outputTokens: payload.outputTokens || 0,
                        totalTokens: payload.totalTokens || 0,
                        cost: payload.cost || 0,
                    })
                }
            }),
        ]

        return () => unsubs.forEach((fn) => fn())
    }, [setConnection, setSessions, addLog, addTokenUsage, addChatMessage, addNotification, updateAgent])

    const connect = useCallback((url: string, token?: string) => {
        client.connect(url, token)
    }, [client])

    const disconnect = useCallback(() => {
        client.disconnect()
    }, [client])

    const reconnect = useCallback(() => {
        client.reconnect()
    }, [client])

    const sendMessage = useCallback((message: unknown) => {
        return client.send(message)
    }, [client])

    const isConnected = useMissionControl((s) => s.connection.isConnected)
    const connectionState = useMissionControl((s) => s.connection)

    return {
        isConnected,
        connectionState,
        connect,
        disconnect,
        reconnect,
        sendMessage,
    }
}
