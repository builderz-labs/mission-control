'use client'

import { useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('SSE')

interface ServerEvent {
  type: string
  data: any
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
      switch (event.type) {
        case 'connected':
          // Initial connection ack, nothing to do
          break

        // Task events
        case 'task.created':
          addTask(event.data)
          break
        case 'task.updated':
          if (event.data?.id) {
            updateTask(event.data.id, event.data)
          }
          break
        case 'task.status_changed':
          if (event.data?.id) {
            updateTask(event.data.id, {
              status: event.data.status,
              updated_at: event.data.updated_at,
            })
          }
          break
        case 'task.deleted':
          if (event.data?.id) {
            deleteTask(event.data.id)
          }
          break

        // Agent events
        case 'agent.created':
          addAgent(event.data)
          break
        case 'agent.updated':
        case 'agent.status_changed':
          if (event.data?.id) {
            updateAgent(event.data.id, event.data)
          }
          break

        // Chat events
        case 'chat.message':
          if (event.data?.id) {
            addChatMessage({
              id: event.data.id,
              conversation_id: event.data.conversation_id,
              from_agent: event.data.from_agent,
              to_agent: event.data.to_agent,
              content: event.data.content,
              message_type: event.data.message_type || 'text',
              metadata: event.data.metadata,
              read_at: event.data.read_at,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Notification events
        case 'notification.created':
          if (event.data?.id) {
            addNotification({
              id: event.data.id as number,
              recipient: event.data.recipient || 'operator',
              type: event.data.type || 'info',
              title: event.data.title || '',
              message: event.data.message || '',
              source_type: event.data.source_type,
              source_id: event.data.source_id,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Scaling events — refresh agent list on hire/retire
        case 'scaling.hire.approved':
          if (event.data?.agentId) {
            // Agent was auto-created; agent.created event handles the store update
            log.info(`Scaling: agent ${event.data.agentId} hired`)
          }
          break
        case 'scaling.retire.initiated':
          if (event.data?.agentId) {
            updateAgent(event.data.agentId, { status: 'offline' })
          }
          break

        // Workflow events — log approval requests
        case 'workflow.phase.approval_required':
          log.info('Workflow phase requires approval', event.data)
          break

        // Activity events
        case 'activity.created':
          if (event.data?.id) {
            addActivity({
              id: event.data.id as number,
              type: event.data.type,
              entity_type: event.data.entity_type,
              entity_id: event.data.entity_id,
              actor: event.data.actor,
              description: event.data.description,
              data: event.data.data,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
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
