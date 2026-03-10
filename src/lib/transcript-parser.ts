import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/i

function isSilentReplyText(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text.trim())
}

function parseTranscriptParts(content: unknown): MessageContentPart[] {
  const parts: MessageContentPart[] = []

  if (typeof content === 'string' && content.trim()) {
    if (!isSilentReplyText(content)) {
      parts.push({ type: 'text', text: content.trim().slice(0, 8000) })
    }
    return parts
  }

  if (!Array.isArray(content)) return parts

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      if (!isSilentReplyText(block.text)) {
        parts.push({ type: 'text', text: block.text.trim().slice(0, 8000) })
      }
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push({ type: 'thinking', thinking: block.thinking.slice(0, 4000) })
    } else if (block.type === 'tool_use') {
      parts.push({
        type: 'tool_use',
        id: block.id || '',
        name: block.name || 'unknown',
        input: JSON.stringify(block.input || {}).slice(0, 500),
      })
    } else if (block.type === 'tool_result') {
      const resultContent = typeof block.content === 'string' ? block.content
        : Array.isArray(block.content) ? block.content.map((c: any) => c?.text || '').join('\n')
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

  return parts
}

function normalizeTranscriptMessage(msg: any, timestamp?: string): TranscriptMessage | null {
  const role = msg?.role === 'assistant' ? 'assistant' as const
    : msg?.role === 'system' ? 'system' as const
    : 'user' as const

  const parts = parseTranscriptParts(msg?.content ?? msg?.text)
  if (parts.length === 0) return null
  return { role, parts, timestamp }
}

/**
 * Parse OpenClaw JSONL transcript format.
 *
 * Each line is a JSON object. We care about entries with type: "message"
 * which contain { message: { role, content } } in Claude API format.
 */
export function parseJsonlTranscript(raw: string, limit: number): TranscriptMessage[] {
  const lines = raw.split('\n').filter(Boolean)
  const out: TranscriptMessage[] = []

  for (const line of lines) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (entry.type !== 'message' || !entry.message) continue

    const msg = entry.message
    const ts = typeof entry.timestamp === 'string' ? entry.timestamp
      : typeof msg.timestamp === 'string' ? msg.timestamp
      : undefined
    const normalized = normalizeTranscriptMessage(msg, ts)
    if (normalized) {
      out.push(normalized)
    }
  }

  return out.slice(-limit)
}

export function parseGatewayHistoryTranscript(messages: unknown[], limit: number): TranscriptMessage[] {
  const out: TranscriptMessage[] = []

  for (const value of messages) {
    const entry = value as any
    if (!entry || typeof entry !== 'object') continue
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    const normalized = normalizeTranscriptMessage(entry, timestamp)
    if (normalized) {
      out.push(normalized)
    }
  }

  return out.slice(-limit)
}

/**
 * Read a session's JSONL transcript file from disk given stateDir, agentName, and sessionId.
 */
export function readSessionJsonl(stateDir: string, agentName: string, sessionId: string): string | null {
  const jsonlPath = path.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(jsonlPath)) return null
  try {
    return readFileSync(jsonlPath, 'utf-8')
  } catch {
    return null
  }
}
