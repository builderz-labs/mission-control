import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/command'
import { getOpenCodeExecutable } from '@/lib/opencode-sessions'

type ContinueKind = 'claude-code' | 'codex-cli' | 'opencode'

function sanitizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * POST /api/sessions/continue
 * Body: { kind: 'claude-code'|'codex-cli'|'opencode', id: string, prompt: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body?.kind as ContinueKind
    const sessionId = typeof body?.id === 'string' ? body.id.trim() : ''
    const prompt = sanitizePrompt(body?.prompt)

    if (!sessionId || !/^[a-zA-Z0-9._:-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }
    if (kind !== 'claude-code' && kind !== 'codex-cli' && kind !== 'opencode') {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (!prompt || prompt.length > 6000) {
      return NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 })
    }

    let reply = ''

    if (kind === 'claude-code') {
      const result = await runCommand('claude', ['--print', '--resume', sessionId, prompt], {
        timeoutMs: 180000,
      })
      reply = (result.stdout || '').trim() || (result.stderr || '').trim()
    } else if (kind === 'codex-cli') {
      const outputPath = path.join('/tmp', `mc-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      try {
        await runCommand('codex', ['exec', 'resume', sessionId, prompt, '--skip-git-repo-check', '-o', outputPath], {
          timeoutMs: 180000,
        })
      } finally {
        // Read after run attempt either way for best-effort output
      }

      try {
        reply = (await fs.readFile(outputPath, 'utf-8')).trim()
      } catch {
        reply = ''
      }

      try {
        await fs.unlink(outputPath)
      } catch {
        // ignore
      }
    } else {
      const result = await runCommand(getOpenCodeExecutable(), ['run', '--session', sessionId, prompt], {
        timeoutMs: 180000,
      })
      reply = (result.stdout || '').trim() || (result.stderr || '').trim()
    }

    if (!reply) {
      reply = 'Session continued, but no text response was returned.'
    }

    return NextResponse.json({ ok: true, reply })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/continue error')
    return NextResponse.json({ error: error?.message || 'Failed to continue session' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
