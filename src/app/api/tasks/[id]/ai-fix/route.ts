import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

// Compact cached system prompt — saves ~80% input tokens on repeated calls
const SYSTEM_PROMPT = 'You are a concise bug-fix assistant. Analyze the task and suggest the minimal fix. Be direct and practical. Max 150 words.'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** POST /api/tasks/[id]/ai-fix — ask Claude Haiku to analyze task and suggest fix */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured. Add it to .env or Credentials.' }, { status: 503 })
  }

  try {
    const { id } = await params
    const db = getDatabase()
    const task = db.prepare('SELECT title, description, status, priority FROM tasks WHERE id = ?').get(id) as any
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Compact user message — minimal tokens
    const userMsg = `Task: ${task.title}${task.description ? `\nContext: ${task.description}` : ''}\nStatus: ${task.status} | Priority: ${task.priority}`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content: userMsg }],
    })

    const suggestion = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0

    // Save as comment
    const now = Math.floor(Date.now() / 1000)
    const commentResult = db.prepare(
      'INSERT INTO comments (task_id, author, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(Number(id), 'claude-haiku', `🤖 **AI Analysis** (${inputTokens}in/${outputTokens}out tokens)\n\n${suggestion}`, now)

    return NextResponse.json({
      comment_id: commentResult.lastInsertRowid,
      suggestion,
      tokens: { input: inputTokens, output: outputTokens }
    })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/[id]/ai-fix error')
    return NextResponse.json({ error: err.message || 'AI fix failed' }, { status: 500 })
  }
}
