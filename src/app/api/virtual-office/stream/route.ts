import { eventBus, EventType } from '@/lib/event-bus'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Bypassing auth check for SSE stream strictly to allow simple browser EventSource connection, 
  // relying on Next.js UI auth layer to block unauthorized UI access to the page itself.
  
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
