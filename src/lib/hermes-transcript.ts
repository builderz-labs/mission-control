import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { pushMessage, textPart, type TranscriptMessage } from '@/lib/session-transcript-types'

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

function toolName(call: Record<string, unknown>, fallback: string | null): string {
  const fn = call.function && typeof call.function === 'object'
    ? call.function as Record<string, unknown>
    : null
  if (typeof fn?.name === 'string') return fn.name
  if (typeof call.tool_name === 'string') return call.tool_name
  return fallback || 'tool'
}

function pushToolCalls(row: HermesMessageRow, parts: TranscriptMessage['parts']): void {
  if (row.role !== 'assistant' || !row.tool_calls) return
  try {
    const toolCalls = JSON.parse(row.tool_calls) as Array<Record<string, unknown>>
    for (const call of toolCalls) {
      const fn = call.function && typeof call.function === 'object'
        ? call.function as Record<string, unknown>
        : null
      const id = typeof call.call_id === 'string' ? call.call_id
        : typeof call.id === 'string' ? call.id : ''
      const input = typeof fn?.arguments === 'string'
        ? fn.arguments
        : JSON.stringify(fn?.arguments || {})
      parts.push({ type: 'tool_use', id, name: toolName(call, row.tool_name), input: String(input).slice(0, 4000) })
    }
  } catch { /* malformed tool payload */ }
}

export function readHermesTranscriptFromDbPath(
  dbPath: string,
  sessionId: string,
  limit: number,
): TranscriptMessage[] {
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
      if (row.role === 'tool') {
        pushMessage(messages, 'system', [{
          type: 'tool_result',
          toolUseId: row.tool_call_id || '',
          content: String(row.content || '').trim().slice(0, 8000),
          isError: row.content?.includes('"success": false') || row.content?.includes('"error"'),
        }], timestamp)
        continue
      }
      const parts: TranscriptMessage['parts'] = []
      pushToolCalls(row, parts)
      const text = textPart(row.content)
      if (text) parts.push(text)
      if (row.role === 'assistant') pushMessage(messages, 'assistant', parts, timestamp)
      else if (row.role === 'user') pushMessage(messages, 'user', parts, timestamp)
    }
    return messages.slice(-limit)
  } catch (error) {
    logger.warn({ err: error, dbPath, sessionId }, 'Failed to read Hermes transcript')
    return []
  } finally {
    try { db?.close() } catch { /* noop */ }
  }
}

export function readHermesTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  return readHermesTranscriptFromDbPath(
    path.join(config.homeDir, '.hermes', 'state.db'),
    sessionId,
    limit,
  )
}
