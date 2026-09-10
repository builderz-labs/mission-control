import fs from 'node:fs'
import Database from 'better-sqlite3'
import { logger } from '@/lib/logger'
import { getOpenCodeDbCandidates, epochMsToIso } from '@/lib/opencode-sessions'
import { textPart, type TranscriptMessage } from '@/lib/session-transcript-types'

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pushParsedParts(
  db: Database.Database,
  rowId: number,
  parts: TranscriptMessage['parts'],
): void {
  const partRows = db.prepare(
    'SELECT data FROM part WHERE message_id = ? ORDER BY rowid ASC',
  ).all(rowId) as Array<{ data: string | null }>
  for (const pr of partRows) {
    if (!pr.data) continue
    let parsed: unknown
    try { parsed = JSON.parse(pr.data) } catch { continue }
    const item = rec(parsed)
    if (!item) continue
    if (item.type === 'text' && typeof item.text === 'string') {
      const part = textPart(item.text)
      if (part) parts.push(part)
    } else if (item.type === 'tool' && typeof item.tool === 'string') {
      const part = textPart(`[Tool: ${item.tool}]`, 200)
      if (part) parts.push(part)
    }
  }
}

function fallbackParts(parsed: Record<string, unknown>): TranscriptMessage['parts'] {
  const parts: TranscriptMessage['parts'] = []
  if (typeof parsed.content === 'string') {
    const part = textPart(parsed.content)
    if (part) parts.push(part)
  }
  if (parsed.summary && typeof parsed.summary === 'object') {
    const part = textPart(JSON.stringify(parsed.summary), 4000)
    if (part) parts.push(part)
  }
  const err = rec(parsed.error)
  if (err) {
    const data = rec(err.data)
    const detail = typeof data?.message === 'string'
      ? data.message
      : typeof err.name === 'string' ? err.name : JSON.stringify(err)
    const part = textPart(`Error: ${detail}`, 4000)
    if (part) parts.push(part)
  }
  const tokens = rec(parsed.tokens)
  if (tokens) {
    const total = tokens.total ?? (Number(tokens.input || 0) + Number(tokens.output || 0))
    const part = textPart(`Tokens: ${total}`, 200)
    if (part) parts.push(part)
  }
  return parts
}

function mapRole(role: string): TranscriptMessage['role'] {
  return role === 'assistant' || role === 'user' || role === 'system' ? role : 'system'
}

export function readOpenCodeTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  for (const dbPath of getOpenCodeDbCandidates()) {
    if (!dbPath || !fs.existsSync(dbPath)) continue
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      const hasMessage = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get('message')
      if (!hasMessage) continue
      const hasPart = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get('part')
      const rows = db.prepare(
        `SELECT id, data, time_created, time_updated
         FROM (
           SELECT id, data, time_created, time_updated
           FROM message
           WHERE session_id = ?
           ORDER BY COALESCE(time_updated, time_created) DESC
           LIMIT ?
         ) recent
         ORDER BY COALESCE(time_updated, time_created) ASC`,
      ).all(sessionId, Math.max(1, limit * 4)) as Array<{
        id: number; data: string | null; time_created: number | null; time_updated: number | null
      }>
      if (rows.length === 0) continue
      const messages: TranscriptMessage[] = []
      for (const row of rows) {
        if (!row.data) continue
        let parsedUnknown: unknown
        try { parsedUnknown = JSON.parse(row.data) } catch { continue }
        const parsed = rec(parsedUnknown)
        if (!parsed) continue
        const parts: TranscriptMessage['parts'] = []
        if (hasPart && row.id) pushParsedParts(db, row.id, parts)
        if (parts.length === 0) parts.push(...fallbackParts(parsed))
        if (parts.length === 0) continue
        const role = typeof parsed.role === 'string' ? parsed.role : 'system'
        messages.push({
          role: mapRole(role),
          parts,
          timestamp: epochMsToIso(row.time_updated || row.time_created) || undefined,
        })
      }
      if (messages.length > 0) return messages.slice(-limit)
    } catch (error) {
      logger.warn({ err: error, dbPath, sessionId }, 'Failed to read OpenCode transcript')
    } finally {
      try { db?.close() } catch { /* noop */ }
    }
  }
  return []
}
