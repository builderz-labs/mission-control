import { eventBus, EventType } from '@/lib/event-bus'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = getUserFromRequest(request)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      
      const sendEvent = (data: any) => {
        try {
          // SSE format: data: JSON_STRING\n\n
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch (e) {
          // Stream closed/aborted
        }
      }

      // Initial ping to establish connection
      sendEvent({ type: 'ping' })

      const messageListener = (event: any) => sendEvent({ type: 'message', payload: event.data })
      const clearListener = () => sendEvent({ type: 'cleared' })
      
      eventBus.on('virtual-office.message' as EventType, messageListener)
      eventBus.on('virtual-office.cleared' as EventType, clearListener)
      
      request.signal.addEventListener('abort', () => {
        eventBus.off('virtual-office.message' as EventType, messageListener)
        eventBus.off('virtual-office.cleared' as EventType, clearListener)
        try { controller.close() } catch (e) {}
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}
