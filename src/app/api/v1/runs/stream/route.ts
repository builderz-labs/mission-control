import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { eventBus, type ServerEvent } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

/**
 * GET /api/v1/runs/stream — SSE stream of run events.
 * Emits: run.created, run.updated, run.completed, run.eval_attached
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ServerEvent) => {
        if (!event.type.startsWith('run.')) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`),
          )
        } catch {
          // Client disconnected
        }
      }

      eventBus.on('server-event', send)

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        eventBus.off('server-event', send)
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Agent-Run-Protocol': '0.1.0',
    },
  })
}
