import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

type TranscriptMessage = {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

function messageTimestampMs(message: TranscriptMessage): number {
  if (!message.timestamp) return 0
  const ts = new Date(message.timestamp).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function listRecentFiles(root: string, ext: string, limit: number): string[] {
  if (!root || !fs.existsSync(root)) return []

  const files: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(dir, entry)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        stack.push(full)
        continue
      }

      if (!stat.isFile() || !full.endsWith(ext)) continue
      files.push({ path: full, mtimeMs: stat.mtimeMs })
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files.slice(0, Math.max(1, limit)).map((f) => f.path)
}

function pushMessage(
  list: TranscriptMessage[],
  role: TranscriptMessage['role'],
  parts: MessageContentPart[],
  timestamp?: string,
) {
  if (parts.length === 0) return
  list.push({ role, parts, timestamp })
}

function textPart(content: string | null, limit = 8000): MessageContentPart | null {
  const text = String(content || '').trim()
  if (!text) return null
  return { type: 'text', text: text.slice(0, limit) }
}

function readClaudeTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const root = path.join(config.claudeHome, 'projects')
  const files = listRecentFiles(root, '.jsonl', 300)
  const out: TranscriptMessage[] = []

  for (const file of files) {
    let raw = ''
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      if (parsed?.sessionId !== sessionId || parsed?.isSidechain) continue

      const ts = typeof parsed?.timestamp === 'string' ? parsed.timestamp : undefined
      if (parsed?.type === 'user') {
        const rawContent = parsed?.message?.content
        // Check if this is a tool_result array (not real user input)
        if (Array.isArray(rawContent) && rawContent.some((b: any) => b?.type === 'tool_result')) {
          const parts: MessageContentPart[] = []
          for (const block of rawContent) {
            if (block?.type === 'tool_result') {
              const resultContent = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c?.text || '').join('\n')
                  : ''
              if (resultContent.trim()) {
                parts.push({
                  type: 'tool_result',
                  toolUseId: block.tool_use_id || '',
                  content: resultContent.trim().slice(0, 8000),
                  isError: block.is_error === true,
                })
              }
            }
          }
          pushMessage(out, 'system', parts, ts)
        } else {
          const content = typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.map((b: any) => b?.text || '').join('\n').trim()
              : ''
          const part = textPart(content)
          if (part) pushMessage(out, 'user', [part], ts)
        }
      } else if (parsed?.type === 'assistant') {
        const parts: MessageContentPart[] = []
        if (Array.isArray(parsed?.message?.content)) {
          for (const block of parsed.message.content) {
            if (block?.type === 'thinking' && typeof block?.thinking === 'string') {
              const thinking = block.thinking.trim()
              if (thinking) {
                parts.push({ type: 'thinking', thinking: thinking.slice(0, 4000) })
              }
            } else if (block?.type === 'text' && typeof block?.text === 'string') {
              const part = textPart(block.text)
              if (part) parts.push(part)
            } else if (block?.type === 'tool_use') {
              parts.push({
                type: 'tool_use',
                id: block.id || '',
                name: block.name || 'unknown',
                input: JSON.stringify(block.input || {}).slice(0, 500),
              })
            }
          }
        }
        pushMessage(out, 'assistant', parts, ts)
      }
    }
  }

  const sorted = out
    .slice()
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return sorted.slice(-limit)
}

function readCodexTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const root = path.join(config.homeDir, '.codex', 'sessions')
  const files = listRecentFiles(root, '.jsonl', 300)
  const out: TranscriptMessage[] = []

  for (const file of files) {
    let raw = ''
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    let matchedSession = file.includes(sessionId)
    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      if (!matchedSession && parsed?.type === 'session_meta' && parsed?.payload?.id === sessionId) {
        matchedSession = true
      }
      if (!matchedSession) continue

      const ts = typeof parsed?.timestamp === 'string' ? parsed.timestamp : undefined
      if (parsed?.type === 'response_item') {
        const payload = parsed?.payload
        if (payload?.type === 'message') {
          const role = payload?.role === 'assistant' ? 'assistant' as const : 'user' as const
          const parts: MessageContentPart[] = []
          if (typeof payload?.content === 'string') {
            const part = textPart(payload.content)
            if (part) parts.push(part)
          } else if (Array.isArray(payload?.content)) {
            for (const block of payload.content) {
              const blockType = String(block?.type || '')
              // Codex CLI emits message content as input_text/output_text.
              if (
                (blockType === 'text' || blockType === 'input_text' || blockType === 'output_text')
                && typeof block?.text === 'string'
              ) {
                const part = textPart(block.text)
                if (part) parts.push(part)
              }
            }
          }
          pushMessage(out, role, parts, ts)
        }
      }
    }
  }

  const sorted = out
    .slice()
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return sorted.slice(-limit)
}

type HermesMessageRow = {
  role: string
  content: string | null
  tool_call_id: string | null
  tool_calls: string | null
  tool_name: string | null
  timestamp: number
}

function epochSecondsToISO(epoch: number | null | undefined): string | undefined {
  if (!epoch || !Number.isFinite(epoch) || epoch <= 0) return undefined
  return new Date(epoch * 1000).toISOString()
}

function readHermesTranscriptFromDbPath(dbPath: string, sessionId: string, limit: number): TranscriptMessage[] {
  if (!dbPath || !fs.existsSync(dbPath)) return []

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })

    const rows = db.prepare(`
      SELECT role, content, tool_call_id, tool_calls, tool_name, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(sessionId, Math.max(1, limit * 4)) as HermesMessageRow[]

    const messages: TranscriptMessage[] = []

    for (const row of rows) {
      const timestamp = epochSecondsToISO(row.timestamp)
      const parts: MessageContentPart[] = []

      if (row.role === 'assistant' && row.tool_calls) {
        try {
          const toolCalls = JSON.parse(row.tool_calls) as Array<Record<string, unknown>>
          for (const call of toolCalls) {
            const fn = call.function
            const fnRecord = fn && typeof fn === 'object' ? fn as Record<string, unknown> : null
            const name = typeof fnRecord?.name === 'string'
              ? fnRecord.name
              : typeof call.tool_name === 'string'
                ? String(call.tool_name)
                : typeof row.tool_name === 'string'
                  ? row.tool_name
                  : 'tool'
            const id = typeof call.call_id === 'string'
              ? call.call_id
              : typeof call.id === 'string'
                ? call.id
                : ''
            const input = typeof fnRecord?.arguments === 'string'
              ? fnRecord.arguments
              : JSON.stringify(fnRecord?.arguments || {})
            parts.push({
              type: 'tool_use',
              id,
              name,
              input: String(input).slice(0, 4000),
            })
          }
        } catch {
          // Ignore malformed tool call payloads and fall back to text content if present.
        }
      }

      const text = textPart(row.content)
      if (text) parts.push(text)

      if (row.role === 'tool') {
        pushMessage(messages, 'system', [{
          type: 'tool_result',
          toolUseId: row.tool_call_id || '',
          content: String(row.content || '').trim().slice(0, 8000),
          isError: row.content?.includes('"success": false') || row.content?.includes('"error"'),
        }], timestamp)
        continue
      }

      if (row.role === 'assistant') {
        pushMessage(messages, 'assistant', parts, timestamp)
        continue
      }

      if (row.role === 'user') {
        pushMessage(messages, 'user', parts, timestamp)
      }
    }

    return messages.slice(-limit)
  } catch (error) {
    logger.warn({ err: error, dbPath, sessionId }, 'Failed to read Hermes transcript')
    return []
  } finally {
    try { db?.close() } catch { /* noop */ }
  }
}

function readHermesTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const dbPath = path.join(config.homeDir, '.hermes', 'state.db')
  return readHermesTranscriptFromDbPath(dbPath, sessionId, limit)
}

/**
 * GET /api/sessions/transcript
 * Query params:
 *   kind=claude-code|codex-cli|hermes
 *   id=<session-id>
 *   limit=40
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') || ''
    const sessionId = searchParams.get('id') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '40', 10), 200)

    if (!sessionId || (kind !== 'claude-code' && kind !== 'codex-cli' && kind !== 'hermes')) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
    }

    const messages = kind === 'claude-code'
      ? readClaudeTranscript(sessionId, limit)
      : kind === 'codex-cli'
        ? readCodexTranscript(sessionId, limit)
        : readHermesTranscript(sessionId, limit)

    return NextResponse.json({ messages })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/sessions/transcript error')
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const __testables = { readHermesTranscriptFromDbPath }
