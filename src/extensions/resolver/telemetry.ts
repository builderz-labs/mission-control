/**
 * Resolver Telemetry Ingest (Option B: file-tailing)
 *
 * Tails the openclaw-tool-resolver JSONL telemetry file, parses entries, and
 * persists them into MC SQLite for join-based analysis against litellm_usage.
 *
 * Design notes:
 *  - The resolver plugin writes JSONL in a fire-and-forget fashion. We follow
 *    the same best-effort pattern here: any error is logged and swallowed.
 *  - We track byte offset in `resolver_telemetry_cursor` to resume across
 *    MC restarts without re-ingesting or losing data.
 *  - File rotation: the plugin rotates the file when it grows > 5MB, renaming
 *    the old file to `*-archive-{ts}.jsonl` and starting fresh. When our
 *    offset exceeds the current file size, we assume rotation and reset to 0.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getDatabase } from '@/lib/db'
import { getOpenclawWorkspaceDir } from './workspace-paths'

export type ResolverTelemetryEntry = {
  turn?: number
  toolsAllow?: string[]
  source?: string
  confidence?: number
  reasoning?: string
  llmLatencyMs?: number
  llmTools?: string[]
  finalTools?: string[]
  availableTools?: string[]
  validationAction?: string
  llmError?: string
  promptExcerpt?: string
  sessionId?: string
  agentId?: string
  ts?: string
}

export type IngestResult = {
  linesRead: number
  linesInserted: number
  rotated: boolean
  errors: number
  filePath: string
  endOffset: number
}

const CURSOR_KEY = 'default'

/**
 * Resolve the default resolver telemetry path. Prefers env override, then the
 * OpenClaw workspace dir (standard production layout).
 */
export function resolveTelemetryPath(): string {
  if (process.env.MC_RESOLVER_TELEMETRY_PATH) {
    return process.env.MC_RESOLVER_TELEMETRY_PATH
  }
  const workspaceDir = getOpenclawWorkspaceDir()
  if (workspaceDir) {
    return path.join(workspaceDir, 'resolver-telemetry.jsonl')
  }
  return ''
}

/**
 * Ensure resolver_telemetry tables exist. Called by the migration but also
 * defensively at ingest time.
 */
export function ensureResolverTables(db: ReturnType<typeof getDatabase>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolver_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn INTEGER,
      session_id TEXT,
      agent_id TEXT,
      source TEXT,
      confidence REAL,
      reasoning TEXT,
      llm_latency_ms REAL,
      llm_tools TEXT,
      final_tools TEXT,
      tools_allow TEXT,
      available_tools TEXT,
      validation_action TEXT,
      llm_error TEXT,
      prompt_excerpt TEXT,
      raw TEXT NOT NULL,
      ts TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resolver_telemetry_ts ON resolver_telemetry(ts)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resolver_telemetry_session ON resolver_telemetry(session_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS resolver_telemetry_cursor (
      key TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      inode INTEGER,
      last_ingest_at INTEGER
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS resolver_metrics_daily (
      day TEXT PRIMARY KEY,
      classifications INTEGER DEFAULT 0,
      llm_calls INTEGER DEFAULT 0,
      llm_errors INTEGER DEFAULT 0,
      avg_confidence REAL,
      avg_llm_latency_ms REAL,
      tools_narrowed INTEGER DEFAULT 0,
      tokens_saved_est INTEGER DEFAULT 0,
      prompt_tokens_observed INTEGER DEFAULT 0,
      cost_usd_observed REAL DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `)
}

type CursorRow = {
  file_path: string
  byte_offset: number
  file_size: number
  inode: number | null
}

function getCursor(db: ReturnType<typeof getDatabase>): CursorRow | null {
  const row = db
    .prepare(
      `SELECT file_path, byte_offset, file_size, inode
       FROM resolver_telemetry_cursor WHERE key = ?`
    )
    .get(CURSOR_KEY) as CursorRow | undefined
  return row ?? null
}

function setCursor(
  db: ReturnType<typeof getDatabase>,
  filePath: string,
  byteOffset: number,
  fileSize: number,
  inode: number | null,
): void {
  db.prepare(
    `INSERT INTO resolver_telemetry_cursor (key, file_path, byte_offset, file_size, inode, last_ingest_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(key) DO UPDATE SET
       file_path = excluded.file_path,
       byte_offset = excluded.byte_offset,
       file_size = excluded.file_size,
       inode = excluded.inode,
       last_ingest_at = excluded.last_ingest_at`,
  ).run(CURSOR_KEY, filePath, byteOffset, fileSize, inode)
}

/**
 * Read a file slice from `start` to EOF.
 */
function readSlice(filePath: string, start: number): string {
  const fd = fs.openSync(filePath, 'r')
  try {
    const stats = fs.fstatSync(fd)
    if (start >= stats.size) return ''
    const len = stats.size - start
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    return buf.toString('utf-8')
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Parse a JSONL chunk. Returns { entries, bytesConsumed, malformed }.
 * We only advance the cursor by bytesConsumed so that a partial final line
 * (write-in-progress) is safely re-read next tick.
 */
export function parseJsonlChunk(chunk: string): {
  entries: ResolverTelemetryEntry[]
  bytesConsumed: number
  malformed: number
} {
  if (!chunk) return { entries: [], bytesConsumed: 0, malformed: 0 }

  const entries: ResolverTelemetryEntry[] = []
  let bytesConsumed = 0
  let malformed = 0
  let cursor = 0

  while (cursor < chunk.length) {
    const nl = chunk.indexOf('\n', cursor)
    if (nl === -1) break // partial line at tail — wait for next tick
    const raw = chunk.slice(cursor, nl).trim()
    bytesConsumed = Buffer.byteLength(chunk.slice(0, nl + 1), 'utf-8')
    cursor = nl + 1

    if (!raw) continue
    try {
      entries.push(JSON.parse(raw) as ResolverTelemetryEntry)
    } catch {
      malformed++
    }
  }

  return { entries, bytesConsumed, malformed }
}

function insertEntry(
  db: ReturnType<typeof getDatabase>,
  entry: ResolverTelemetryEntry,
): void {
  const toJson = (value: unknown) => (value === undefined ? null : JSON.stringify(value))

  db.prepare(
    `INSERT INTO resolver_telemetry (
      turn, session_id, agent_id, source, confidence, reasoning,
      llm_latency_ms, llm_tools, final_tools, tools_allow, available_tools,
      validation_action, llm_error, prompt_excerpt, raw, ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.turn ?? null,
    entry.sessionId ?? null,
    entry.agentId ?? null,
    entry.source ?? null,
    entry.confidence ?? null,
    entry.reasoning ?? null,
    entry.llmLatencyMs ?? null,
    toJson(entry.llmTools),
    toJson(entry.finalTools),
    toJson(entry.toolsAllow),
    toJson(entry.availableTools),
    entry.validationAction ?? null,
    entry.llmError ?? null,
    entry.promptExcerpt ?? null,
    JSON.stringify(entry),
    entry.ts ?? null,
  )
}

/**
 * Ingest any new lines from the resolver telemetry file into MC SQLite.
 * Idempotent and safe to invoke on a timer.
 */
export function ingestResolverTelemetry(options?: {
  filePath?: string
  db?: ReturnType<typeof getDatabase>
}): IngestResult {
  const filePath = options?.filePath ?? resolveTelemetryPath()
  const result: IngestResult = {
    linesRead: 0,
    linesInserted: 0,
    rotated: false,
    errors: 0,
    filePath,
    endOffset: 0,
  }

  if (!filePath) return result
  if (!fs.existsSync(filePath)) return result

  const db = options?.db ?? getDatabase()
  ensureResolverTables(db)

  const stats = fs.statSync(filePath)
  const inode = stats.ino ?? null
  const cursor = getCursor(db)

  let startOffset = 0
  if (cursor) {
    const sameFile = cursor.file_path === filePath && (cursor.inode === null || cursor.inode === inode)
    if (!sameFile || cursor.byte_offset > stats.size) {
      result.rotated = true
      startOffset = 0
    } else {
      startOffset = cursor.byte_offset
    }
  }

  if (startOffset >= stats.size) {
    setCursor(db, filePath, startOffset, stats.size, inode)
    result.endOffset = startOffset
    return result
  }

  const chunk = readSlice(filePath, startOffset)
  const { entries, bytesConsumed, malformed } = parseJsonlChunk(chunk)
  result.errors = malformed
  result.linesRead = entries.length + malformed

  if (entries.length > 0) {
    const tx = db.transaction((rows: ResolverTelemetryEntry[]) => {
      for (const r of rows) {
        try {
          insertEntry(db, r)
          result.linesInserted++
        } catch {
          result.errors++
        }
      }
    })
    tx(entries)
  }

  const newOffset = startOffset + bytesConsumed
  setCursor(db, filePath, newOffset, stats.size, inode)
  result.endOffset = newOffset

  return result
}

/**
 * Aggregate resolver_telemetry into resolver_metrics_daily. Joined against
 * litellm_usage by matching day buckets. Fully idempotent (upsert by day).
 */
export function rebuildResolverDailyMetrics(options?: {
  db?: ReturnType<typeof getDatabase>
  days?: number
}): { days: number } {
  const db = options?.db ?? getDatabase()
  ensureResolverTables(db)
  const days = options?.days ?? 30

  const sinceSeconds = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60

  const telemetryRows = db
    .prepare(
      `SELECT
         substr(COALESCE(ts, datetime(created_at, 'unixepoch')), 1, 10) AS day,
         COUNT(*) AS classifications,
         SUM(CASE WHEN source = 'llm' THEN 1 ELSE 0 END) AS llm_calls,
         SUM(CASE WHEN llm_error IS NOT NULL AND llm_error != '' THEN 1 ELSE 0 END) AS llm_errors,
         AVG(confidence) AS avg_confidence,
         AVG(llm_latency_ms) AS avg_llm_latency_ms,
         SUM(CASE WHEN available_tools IS NOT NULL AND tools_allow IS NOT NULL
                  AND json_array_length(available_tools) > json_array_length(tools_allow)
              THEN json_array_length(available_tools) - json_array_length(tools_allow)
              ELSE 0 END) AS tools_narrowed
       FROM resolver_telemetry
       WHERE created_at >= ?
       GROUP BY day
       ORDER BY day`,
    )
    .all(sinceSeconds) as Array<{
      day: string
      classifications: number
      llm_calls: number
      llm_errors: number
      avg_confidence: number | null
      avg_llm_latency_ms: number | null
      tools_narrowed: number
    }>

  // 150 tokens/tool is the plugin's rule-of-thumb estimate.
  const TOKENS_PER_TOOL = 150

  // Join LiteLLM usage for the same day to surface ground-truth observed tokens.
  const upsert = db.prepare(
    `INSERT INTO resolver_metrics_daily
      (day, classifications, llm_calls, llm_errors, avg_confidence,
       avg_llm_latency_ms, tools_narrowed, tokens_saved_est,
       prompt_tokens_observed, cost_usd_observed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(day) DO UPDATE SET
       classifications = excluded.classifications,
       llm_calls = excluded.llm_calls,
       llm_errors = excluded.llm_errors,
       avg_confidence = excluded.avg_confidence,
       avg_llm_latency_ms = excluded.avg_llm_latency_ms,
       tools_narrowed = excluded.tools_narrowed,
       tokens_saved_est = excluded.tokens_saved_est,
       prompt_tokens_observed = excluded.prompt_tokens_observed,
       cost_usd_observed = excluded.cost_usd_observed,
       updated_at = unixepoch()`,
  )

  const litellmStmt = db.prepare(
    `SELECT COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens_observed,
            COALESCE(SUM(response_cost), 0) AS cost_usd_observed
     FROM litellm_usage
     WHERE substr(datetime(created_at, 'unixepoch'), 1, 10) = ?`,
  )

  for (const row of telemetryRows) {
    const tokensSaved = row.tools_narrowed * TOKENS_PER_TOOL
    const lit = litellmStmt.get(row.day) as
      | { prompt_tokens_observed: number; cost_usd_observed: number }
      | undefined
    upsert.run(
      row.day,
      row.classifications,
      row.llm_calls,
      row.llm_errors,
      row.avg_confidence,
      row.avg_llm_latency_ms,
      row.tools_narrowed,
      tokensSaved,
      lit?.prompt_tokens_observed ?? 0,
      lit?.cost_usd_observed ?? 0,
    )
  }

  return { days: telemetryRows.length }
}
