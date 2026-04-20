import { NextRequest } from 'next/server'
import { streamText, convertToModelMessages, type UIMessage } from 'ai'

/**
 * DarkMada chat streaming endpoint.
 *
 * Pick a provider based on available env keys. If none are configured,
 * stream a friendly mock response so the UI remains usable in dev.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  messages: UIMessage[]
  model?: string
  system?: string
}

async function resolveModel(requested?: string) {
  const want = (requested || 'auto').toLowerCase()

  if ((want === 'auto' || want.startsWith('claude')) && process.env.ANTHROPIC_API_KEY) {
    const { anthropic } = await import('@ai-sdk/anthropic')
    return anthropic(requested && !requested.includes('auto') ? requested : 'claude-sonnet-4-5')
  }
  if ((want === 'auto' || want.startsWith('gpt')) && process.env.OPENAI_API_KEY) {
    const { openai } = await import('@ai-sdk/openai')
    return openai(requested && !requested.includes('auto') ? requested : 'gpt-4o')
  }
  return null
}

function mockStream(userText: string): Response {
  const reply = [
    `_Running in mock mode — no \`ANTHROPIC_API_KEY\` or \`OPENAI_API_KEY\` set._`,
    ``,
    `You said: **${userText.slice(0, 200)}**`,
    ``,
    `Wire a key into \`.env\` to get real responses. The UI is already configured to stream via the Vercel AI SDK and render with Streamdown.`,
    ``,
    '```ts',
    `// .env`,
    `ANTHROPIC_API_KEY=sk-ant-...`,
    `# or`,
    `OPENAI_API_KEY=sk-...`,
    '```',
  ].join('\n')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const id = crypto.randomUUID()
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', messageId: id })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-start', id: '0' })}\n\n`))
      for (const word of reply.split(/(\s+)/)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', id: '0', delta: word })}\n\n`))
        await new Promise((r) => setTimeout(r, 18))
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-end', id: '0' })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'finish' })}\n\n`))
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-vercel-ai-ui-message-stream': 'v1',
      connection: 'keep-alive',
    },
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body
  const messages = body.messages || []

  try {
    const model = await resolveModel(body.model)
    if (!model) {
      const last = messages[messages.length - 1]
      const text =
        (last?.parts?.find((p) => p.type === 'text') as { text?: string } | undefined)?.text ||
        'Hello'
      return mockStream(text)
    }

    const result = streamText({
      model,
      system:
        body.system ||
        `You are DarkMada, Jackson's internal AI operations assistant. Be concise, technical, and direct. Use markdown for structure. Never apologize or hedge; state what you know or admit the gap.`,
      messages: convertToModelMessages(messages),
    })

    return result.toUIMessageStreamResponse()
  } catch (err) {
    console.error('[dm-chat] error', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
}
