import { existsSync, readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { config } from './config'
import { indexFile } from './memory-search'
import { archivePath, parseArchiveMarkdown } from './session-archive'
import { isTreeKind, projectSlugOf } from './chat-session-identity'
import { resolveWithin } from './safe-home-path'
import type { TranscriptMessage } from './session-transcript-types'

export function ensureSessionTranscriptsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_transcripts (
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      model TEXT,
      path TEXT NOT NULL,
      updated_at INTEGER,
      message_count INTEGER DEFAULT 0,
      last_user_prompt TEXT,
      working_dir TEXT,
      PRIMARY KEY (kind, session_id)
    )
  `)
}

export type ArchivedSessionRow = {
  kind: string
  session_id: string
  project_slug: string
  model: string | null
  path: string
  updated_at: number | null
  message_count: number
  last_user_prompt: string | null
  working_dir: string | null
}

export function upsertArchivedSession(db: Database.Database, row: ArchivedSessionRow): void {
  ensureSessionTranscriptsTable(db)
  db.prepare(`
    INSERT INTO session_transcripts (
      kind, session_id, project_slug, model, path, updated_at, message_count, last_user_prompt, working_dir
    ) VALUES (@kind, @session_id, @project_slug, @model, @path, @updated_at, @message_count, @last_user_prompt, @working_dir)
    ON CONFLICT(kind, session_id) DO UPDATE SET
      project_slug = excluded.project_slug,
      model = excluded.model,
      path = excluded.path,
      updated_at = excluded.updated_at,
      message_count = excluded.message_count,
      last_user_prompt = excluded.last_user_prompt,
      working_dir = excluded.working_dir
  `).run(row)
}

export function listArchivedSessions(db: Database.Database, projectSlug?: string): Array<Record<string, unknown>> {
  ensureSessionTranscriptsTable(db)
  const rows = (projectSlug
    ? db.prepare('SELECT * FROM session_transcripts WHERE project_slug = ? ORDER BY updated_at DESC LIMIT 200').all(projectSlug)
    : db.prepare('SELECT * FROM session_transcripts ORDER BY updated_at DESC LIMIT 200').all()
  ) as ArchivedSessionRow[]
  return rows.map((row) => ({
    id: row.session_id,
    key: row.project_slug || row.session_id,
    agent: row.kind,
    kind: row.kind,
    age: '-',
    model: row.model || row.kind,
    tokens: '0/0',
    channel: 'archive',
    flags: ['archived'],
    active: false,
    startTime: row.updated_at || 0,
    lastActivity: row.updated_at || 0,
    source: 'local',
    lastUserPrompt: row.last_user_prompt,
    workingDir: row.working_dir,
  }))
}

export function indexSessionArchives(db: Database.Database, sessions: Array<Record<string, unknown>>): number {
  const base = config.memoryDir
  if (!base) return 0
  ensureSessionTranscriptsTable(db)
  let indexed = 0
  for (const session of sessions.slice(0, 80)) {
    const kind = typeof session.kind === 'string' ? session.kind : ''
    const sessionId = typeof session.id === 'string' ? session.id : ''
    if (!isTreeKind(kind) || !sessionId) continue
    const workingDir = typeof session.workingDir === 'string' ? session.workingDir : null
    const projectSlug = projectSlugOf(workingDir, 'unknown')
    const relative = archivePath(kind, projectSlug, sessionId)
    const full = resolveWithin(base, relative)
    if (!full || !existsSync(full)) continue
    const existing = db.prepare(
      'SELECT path FROM session_transcripts WHERE kind = ? AND session_id = ?',
    ).get(kind, sessionId) as { path: string } | undefined
    const existingFull = existing?.path ? resolveWithin(base, existing.path) : null
    if (existingFull && existsSync(existingFull)) continue
    upsertArchivedSession(db, {
      kind,
      session_id: sessionId,
      project_slug: projectSlug,
      model: typeof session.model === 'string' ? session.model : null,
      path: relative,
      updated_at: typeof session.lastActivity === 'number' ? session.lastActivity : Date.now(),
      message_count: typeof session.userMessages === 'number' ? session.userMessages : 0,
      last_user_prompt: typeof session.lastUserPrompt === 'string' ? session.lastUserPrompt : null,
      working_dir: workingDir,
    })
    try {
      indexFile(db, base, relative)
    } catch {
      // best-effort FTS
    }
    indexed += 1
  }
  return indexed
}

export function readArchivedTranscript(kind: string, sessionId: string, limit: number, db: Database.Database): TranscriptMessage[] {
  ensureSessionTranscriptsTable(db)
  const row = db.prepare(
    'SELECT path FROM session_transcripts WHERE kind = ? AND session_id = ?',
  ).get(kind, sessionId) as { path: string } | undefined
  if (!row?.path || !config.memoryDir) return []
  const full = resolveWithin(config.memoryDir, row.path)
  if (!full) return []
  let md = ''
  try {
    md = readFileSync(full, 'utf8')
  } catch {
    return []
  }
  return parseArchiveMarkdown(md).slice(-Math.max(1, limit))
}
