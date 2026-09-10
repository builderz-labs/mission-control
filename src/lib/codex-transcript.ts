import { join } from 'node:path'
import { config } from './config'
import { findNamedJsonl, readJsonlTailLines, TRANSCRIPT_TAIL_BYTES } from './jsonl-tail'
import { pushMessage, textPart, type TranscriptMessage } from './session-transcript-types'

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function findCodexTranscriptFile(sessionId: string, root = join(config.homeDir, '.codex', 'sessions')): string | null {
  return findNamedJsonl(root, sessionId)
}

export function parseCodexTranscriptLines(lines: string[], sessionId: string, limit: number, assumeMatch = false): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  let matched = assumeMatch || false
  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const entry = rec(parsed)
    if (!entry) continue
    const payload = rec(entry.payload)
    if (!matched && entry.type === 'session_meta' && str(payload?.id) === sessionId) matched = true
    if (!matched) continue
    if (entry.type !== 'response_item' || rec(payload)?.type !== 'message') continue
    const role = str(payload?.role) === 'assistant' ? 'assistant' as const : 'user' as const
    const parts = contentParts(payload?.content)
    const ts = str(entry.timestamp) || undefined
    pushMessage(out, role, parts, ts)
  }
  return out.slice(-Math.max(1, limit))
}

export function readCodexTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const file = findCodexTranscriptFile(sessionId)
  if (!file) return []
  return parseCodexTranscriptLines(readJsonlTailLines(file, TRANSCRIPT_TAIL_BYTES), sessionId, limit, true)
}

function contentParts(content: unknown) {
  if (typeof content === 'string') {
    const part = textPart(content)
    return part ? [part] : []
  }
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    const item = rec(block)
    const type = str(item?.type)
    if ((type === 'text' || type === 'input_text' || type === 'output_text') && item) {
      const part = textPart(str(item.text))
      return part ? [part] : []
    }
    return []
  })
}
