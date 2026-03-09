import { readFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import { logger } from './logger'

const OPENCLAW_CONFIG = path.join(process.env.HOME || '', '.openclaw/openclaw.json')
const SESSIONS_DIR = path.join(process.env.HOME || '', '.openclaw/agents/main/sessions')
const SESSIONS_JSON = path.join(SESSIONS_DIR, 'sessions.json')
const GATEWAY_URL = 'http://127.0.0.1:18789'

interface LabelResult {
  title: string
  description: string
}

function getHookToken(): string {
  const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
  return config.hooks?.token || ''
}

function fallbackLabel(text: string): LabelResult {
  const firstLine = text.split('\n')[0].trim()
  return {
    title: firstLine.slice(0, 60) + (firstLine.length > 60 ? '…' : ''),
    description: text.trim(),
  }
}

function extractLabelFromSession(sessionKey: string): LabelResult | null {
  try {
    const sessions = JSON.parse(readFileSync(SESSIONS_JSON, 'utf-8'))
    const fullKey = `agent:main:${sessionKey}`
    const session = sessions[fullKey] || sessions[sessionKey]
    if (!session?.sessionId) return null

    const transcriptPath = path.join(SESSIONS_DIR, `${session.sessionId}.jsonl`)
    if (!existsSync(transcriptPath)) return null

    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')

    for (const line of lines) {
      const entry = JSON.parse(line)
      if (entry.type !== 'message') continue
      const msg = entry.message
      if (msg?.role !== 'assistant') continue

      const content = msg.content
      if (!Array.isArray(content)) continue

      for (const block of content) {
        if (block.type !== 'text') continue
        const text = block.text as string

        const match = text.match(/\{[^{}]*"title"\s*:\s*"[^"]*"[^{}]*"description"\s*:\s*"[^"]*"[^{}]*\}/)
        if (match) {
          try {
            const parsed = JSON.parse(match[0])
            if (parsed.title && typeof parsed.title === 'string') return parsed
          } catch { /* continue */ }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

async function pollForResult(sessionKey: string, maxWaitMs = 10000): Promise<LabelResult | null> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const result = extractLabelFromSession(sessionKey)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return null
}

export async function generateTaskLabel(rawText: string): Promise<LabelResult> {
  if (rawText.trim().length < 5) {
    return fallbackLabel(rawText)
  }

  try {
    const token = getHookToken()
    const requestId = randomUUID().slice(0, 8)
    const sessionKey = `hook:eden:task-label-${requestId}`

    const prompt = [
      'Generate a task title and clean description from this rough input.',
      'Respond with ONLY a raw JSON object (no markdown, no code blocks):',
      '{"title": "concise imperative title (max 8 words)", "description": "cleaned up description in markdown"}',
      '',
      'Rules for title:',
      '- Start with a verb (Add, Fix, Build, Implement, Update, etc.)',
      '- Max 8 words, concise and clear',
      '- Capture the core intent',
      '',
      'Rules for description:',
      '- Clean up grammar and structure',
      '- Keep the original meaning and details',
      '- Use markdown formatting if helpful',
      '- If input is already clean, return it as-is',
      '',
      `Raw input:\n${rawText}`,
    ].join('\n')

    const res = await fetch(`${GATEWAY_URL}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: prompt,
        name: 'TaskLabel',
        sessionKey,
        model: 'anthropic/claude-haiku-3.5',
        deliver: false,
        wakeMode: 'next-heartbeat',
        timeoutSeconds: 15,
      }),
    })

    if (!res.ok) throw new Error(`Webhook failed: ${res.status}`)

    const result = await pollForResult(sessionKey, 10000)
    if (result) return result

    logger.warn('AI label generation timed out, using fallback')
    return fallbackLabel(rawText)
  } catch (err) {
    logger.error({ err }, 'AI label generation failed')
    return fallbackLabel(rawText)
  }
}
