'use client'

import { useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'

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
export function useServerEvents() {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

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

        // Reconnect after 3s (EventSource auto-reconnects, but we handle
        // it explicitly to control the sseConnected state)
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mounted) connect()
        }, 3000)
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
