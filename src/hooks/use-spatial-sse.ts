'use client'

import { useEffect, useRef } from 'react'
import { useCanvasStore, type AgentNodeData } from '@/store/canvas-store'

/**
 * Subscribe to SSE events and update the canvas store in real-time.
 * Batches rapid updates via requestAnimationFrame to avoid excessive re-renders.
 */
export function useSpatialSSE() {
  const pendingUpdates = useRef<Array<() => void>>([])
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/events')

    function flushUpdates() {
      const updates = pendingUpdates.current.splice(0)
      for (const update of updates) {
        update()
      }
      rafId.current = null
    }

    function scheduleUpdate(fn: () => void) {
      pendingUpdates.current.push(fn)
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(flushUpdates)
      }
    }

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const store = useCanvasStore.getState()

        switch (msg.type) {
          case 'agent.created':
            scheduleUpdate(() => {
              store.addNode({
                id: `agent-${msg.data.id}`,
                type: 'agent',
                position: { x: 0, y: 0 },
                data: {
                  label: msg.data.name,
                  status: msg.data.status === 'idle' ? 'online' : (msg.data.status || 'offline'),
                  role: msg.data.role,
                  agentId: msg.data.id,
                } satisfies AgentNodeData,
              })
            })
            break

          case 'agent.updated':
          case 'agent.status_changed':
            scheduleUpdate(() => {
              const status = msg.data.status === 'idle' ? 'online' : msg.data.status
              store.updateNodeData(`agent-${msg.data.id}`, {
                ...(status ? { status } : {}),
                ...(msg.data.name ? { label: msg.data.name } : {}),
                ...(msg.data.role ? { role: msg.data.role } : {}),
              })
            })
            break

          case 'agent.deleted':
            scheduleUpdate(() => {
              store.removeNode(`agent-${msg.data.id}`)
            })
            break

          case 'spatial.edge.added':
            scheduleUpdate(() => {
              store.addEdge({
                id: msg.data.edgeId,
                source: `agent-${msg.data.sourceAgentId}`,
                target: `agent-${msg.data.targetAgentId}`,
                type: msg.data.type,
              })
            })
            break

          case 'spatial.edge.removed':
            scheduleUpdate(() => {
              store.removeEdge(msg.data.edgeId)
            })
            break
        }
      } catch {
        // Ignore unparseable events (heartbeats, etc.)
      }
    }

    return () => {
      es.close()
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [])
}
