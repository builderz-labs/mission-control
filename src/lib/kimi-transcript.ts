import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import { isSafeHomePath, realpathInside } from './safe-home-path'
import { isKimiClawPath } from './kimi-sessions'
import {
  blocksToText,
  isNoiseUserText,
  pushMessage,
  textPart,
  type TranscriptMessage,
} from './session-transcript-types'

const MAX_BYTES = 12 * 1024 * 1024

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function originKind(value: unknown): string {
  const rec = asObject(value)
  return typeof rec?.kind === 'string' ? rec.kind : ''
}

function findSessionDir(sessionId: string): string | null {
  const indexPath = join(config.homeDir, '.kimi-code', 'session_index.jsonl')
  let raw = ''
  try {
    raw = readFileSync(indexPath, 'utf8')
  } catch {
    return null
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = asObject(JSON.parse(line))
      if (!row) continue
      if (row.sessionId === sessionId && typeof row.sessionDir === 'string'
        && isSafeHomePath(row.sessionDir, config.homeDir)
        && !isKimiClawPath(row.sessionDir)
        && realpathInside(row.sessionDir, config.homeDir)) {
        return row.sessionDir
      }
    } catch {
      continue
    }
  }
  return null
}

function isoFromTime(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value
    return new Date(ms).toISOString()
  }
  return undefined
}

export function readKimiTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const dir = findSessionDir(sessionId)
  if (!dir) return []
  const file = join(dir, 'agents', 'main', 'wire.jsonl')
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
    if (!line.trim() || line.length > 200_000) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = asObject(parsed)
    if (!row) continue
    const type = typeof row.type === 'string' ? row.type : ''
    const ts = isoFromTime(row.time)
    if (type === 'turn.prompt' && originKind(row.origin) === 'user') {
      const text = blocksToText(row.input)
      if (!text || isNoiseUserText(text)) continue
      const part = textPart(text)
      if (part) pushMessage(out, 'user', [part], ts)
      continue
    }
    if (type !== 'context.append_loop_event') continue
    const event = asObject(row.event)
    if (event?.type !== 'content.part') continue
    const part = asObject(event.part)
    if (part?.type === 'text' && typeof part.text === 'string') {
      const textPartValue = textPart(part.text)
      if (textPartValue) pushMessage(out, 'assistant', [textPartValue], ts)
    } else if (part?.type === 'think' && typeof part.think === 'string' && part.think.trim()) {
      pushMessage(out, 'assistant', [{ type: 'thinking', thinking: part.think.trim().slice(0, 2000) }], ts)
    }
  }
  return out.slice(-Math.max(1, limit))
}
