import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { config } from './config'
import { SESSION_ID_RE } from './jsonl-tail'
import {
  blocksToText,
  isNoiseUserText,
  pushMessage,
  textPart,
  type TranscriptMessage,
} from './session-transcript-types'

const MAX_BYTES = 8 * 1024 * 1024

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function findSessionDir(root: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId) || sessionId === 'sessions') return null
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited < 4000) {
    const dir = stack.pop()
    if (!dir) continue
    visited += 1
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    if (basename(dir) === sessionId) {
      const history = join(dir, 'chat_history.jsonl')
      try {
        if (statSync(history).isFile()) return dir
      } catch { /* keep walking */ }
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) stack.push(full)
      } catch {
        continue
      }
    }
  }
  return null
}

function isoFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  return undefined
}

export function readGrokTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const root = join(config.homeDir, '.grok', 'sessions')
  const dir = findSessionDir(root, sessionId)
  if (!dir) return []
  const file = join(dir, 'chat_history.jsonl')
  let stat
  try {
    stat = statSync(file)
  } catch {
    return []
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return []
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: TranscriptMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = asObject(parsed)
    if (!row) continue
    const type = typeof row.type === 'string' ? row.type : ''
    const ts = isoFromUnknown(row.timestamp || row.created_at)
    if (type === 'user') {
      const text = blocksToText(row.content)
      if (!text || isNoiseUserText(text)) continue
      const part = textPart(text)
      if (part) pushMessage(out, 'user', [part], ts)
    } else if (type === 'assistant') {
      const text = blocksToText(row.content)
      const part = textPart(text)
      if (part) pushMessage(out, 'assistant', [part], ts)
    } else if (type === 'reasoning') {
      const summary = Array.isArray(row.summary) ? row.summary[0] : row.summary
      const rec = asObject(summary)
      const thinking = typeof rec?.text === 'string' ? rec.text : typeof rec?.summary_text === 'string' ? rec.summary_text : ''
      if (thinking.trim()) {
        pushMessage(out, 'assistant', [{ type: 'thinking', thinking: thinking.trim().slice(0, 4000) }], ts)
      }
    }
  }
  return out.slice(-Math.max(1, limit))
}
