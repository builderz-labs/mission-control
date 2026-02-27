import { NextRequest , NextResponse } from 'next/server'
import { eventBus, ServerEvent } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/events - Server-Sent Events stream for real-time DB mutations.
 * Clients connect via EventSource and receive JSON-encoded events.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const encoder = new TextEncoder()

  // Cleanup function, set in start(), called in cancel()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', data: null, timestamp: Date.now() })}\n\n`)
      )

      // Forward all server events to this SSE client
      const handler = (event: ServerEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        } catch {
          // Client disconnected, cleanup will happen in cancel()
        }
      }

      eventBus.on('server-event', handler)

      // Heartbeat every 30s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      cleanup = () => {
        eventBus.off('server-event', handler)
        clearInterval(heartbeat)
      }
    },

    cancel() {
      // Client disconnected
      if (cleanup) cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
