'use client'

import { useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('SSE')

interface ServerEvent {
  type: string
  data: unknown
  timestamp: number
}

/**
 * Hook that connects to the SSE endpoint (/api/events) and dispatches
 * real-time DB mutation events to the Zustand store.
 *
 * SSE provides instant updates for all local-DB data (tasks, agents,
 * chat, activities, notifications), making REST polling a fallback.
 */
const SSE_MAX_RECONNECT_ATTEMPTS = 20
const SSE_BASE_DELAY_MS = 1000
const SSE_MAX_DELAY_MS = 30000

export function useServerEvents() {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const sseReconnectAttemptsRef = useRef<number>(0)

  const {
    setConnection,
    addTask,
    updateTask,
    deleteTask,
    addAgent,
    updateAgent,
    addChatMessage,
    addNotification,
    addActivity,
  } = useMissionControl()

  useEffect(() => {
    let mounted = true

    function connect() {
      if (!mounted) return
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      const es = new EventSource('/api/events')
      eventSourceRef.current = es

      es.onopen = () => {
        if (!mounted) return
        sseReconnectAttemptsRef.current = 0
        setConnection({ sseConnected: true })
      }

      es.onmessage = (event) => {
        if (!mounted) return
        try {
          const payload = JSON.parse(event.data) as ServerEvent
          dispatch(payload)
        } catch {
          // Ignore malformed events
        }
      }

      es.onerror = () => {
        if (!mounted) return
        setConnection({ sseConnected: false })
        es.close()
        eventSourceRef.current = null

        const attempts = sseReconnectAttemptsRef.current
        if (attempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
          log.error(`Max reconnect attempts (${SSE_MAX_RECONNECT_ATTEMPTS}) reached`)
          return
        }

        // Exponential backoff with jitter
        const base = Math.min(Math.pow(2, attempts) * SSE_BASE_DELAY_MS, SSE_MAX_DELAY_MS)
        const delay = Math.round(base + Math.random() * base * 0.5)
        sseReconnectAttemptsRef.current = attempts + 1

        log.warn(`Reconnecting in ${delay}ms (attempt ${attempts + 1}/${SSE_MAX_RECONNECT_ATTEMPTS})`)
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mounted) connect()
        }, delay)
      }
    }

    function dispatch(event: ServerEvent) {
      // Narrow unknown event.data once — SSE payloads are always JSON objects from our server
      const d: Record<string, unknown> =
        event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : {}

      switch (event.type) {
        case 'connected':
          // Initial connection ack, nothing to do
          break

        // Task events — data matches the Task shape broadcasted by route handlers
        case 'task.created':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          addTask(d as any)
          break
        case 'task.updated':
          if (d.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updateTask(d.id as number, d as any)
          }
          break
        case 'task.status_changed':
          if (d.id) {
            updateTask(d.id as number, {
              status: d.status as 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done',
              updated_at: d.updated_at as number,
            })
          }
          break
        case 'task.deleted':
          if (d.id) {
            deleteTask(d.id as number)
          }
          break

        // Agent events — data matches the Agent shape broadcasted by route handlers
        case 'agent.created':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          addAgent(d as any)
          break
        case 'agent.updated':
        case 'agent.status_changed':
          if (d.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updateAgent(d.id as number, d as any)
          }
          break

        // Chat events
        case 'chat.message':
          if (d.id) {
            addChatMessage({
              id: d.id as number,
              conversation_id: d.conversation_id as string,
              from_agent: d.from_agent as string,
              to_agent: d.to_agent as string,
              content: d.content as string,
              message_type: ((d.message_type as string) || 'text') as 'text' | 'system' | 'handoff' | 'status' | 'command' | 'tool_call',
              metadata: d.metadata as string,
              read_at: d.read_at as number,
              created_at: (d.created_at as number) || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Notification events
        case 'notification.created':
          if (d.id) {
            addNotification({
              id: d.id as number,
              recipient: (d.recipient as string) || 'operator',
              type: (d.type as string) || 'info',
              title: (d.title as string) || '',
              message: (d.message as string) || '',
              source_type: d.source_type as string,
              source_id: d.source_id as number,
              created_at: (d.created_at as number) || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Activity events
        case 'activity.created':
          if (d.id) {
            addActivity({
              id: d.id as number,
              type: d.type as string,
              entity_type: d.entity_type as string,
              entity_id: d.entity_id as number,
              actor: d.actor as string,
              description: d.description as string,
              data: d.data as unknown as import('@/store/shared-types').JsonValue,
              created_at: (d.created_at as number) || Math.floor(Date.now() / 1000),
            })
          }
          break
      }
    }

    connect()

    return () => {
      mounted = false
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setConnection({ sseConnected: false })
    }
  }, [
    setConnection,
    addTask,
    updateTask,
    deleteTask,
    addAgent,
    updateAgent,
    addChatMessage,
    addNotification,
    addActivity,
  ])
}
