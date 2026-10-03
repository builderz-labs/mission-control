// Shared fixture builder for ZCode's session database, shaped like the real
// `~/.zcode/cli/db/db.sqlite` that the scanner and the transcript reader read.
import Database from 'better-sqlite3'

export interface FixtureMessage {
  role: 'user' | 'assistant'
  text: string
  createdMs: number
  parts?: Array<Record<string, unknown>>
}

export interface FixtureSession {
  id: string
  updatedMs: number
  directory?: string | null
  parentId?: string | null
  taskType?: string | null
  archivedMs?: number | null
  usage?: { input?: number; output?: number; total?: number; lastMs?: number }
  models?: string[]
  messages?: FixtureMessage[]
}

export function createZcodeSessionDb(db: Database.Database, sessions: FixtureSession[]): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, slug TEXT,
      directory TEXT, path TEXT, title TEXT, version TEXT,
      time_created INTEGER, time_updated INTEGER, task_type TEXT, time_archived INTEGER
    );
    CREATE TABLE turn_usage (
      id INTEGER PRIMARY KEY, session_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER,
      model_request_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, computed_total_tokens INTEGER
    );
    CREATE TABLE model_usage (
      id INTEGER PRIMARY KEY, session_id TEXT, model_id TEXT, status TEXT, completed_at INTEGER
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, sequence INTEGER, data TEXT);
  `)

  const insertSession = db.prepare(
    `INSERT INTO session (id, parent_id, directory, title, time_created, time_updated, task_type, time_archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertTurn = db.prepare(
    `INSERT INTO turn_usage (session_id, status, started_at, completed_at, model_request_count,
      input_tokens, output_tokens, computed_total_tokens)
     VALUES (?, 'completed', ?, ?, 1, ?, ?, ?)`,
  )
  const insertModel = db.prepare(
    `INSERT INTO model_usage (session_id, model_id, status, completed_at) VALUES (?, ?, 'completed', ?)`,
  )
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, sequence, data) VALUES (?, ?, ?, ?)')
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, sequence, data) VALUES (?, ?, ?, ?, ?)')

  for (const session of sessions) {
    insertSession.run(
      session.id,
      session.parentId ?? null,
      session.directory ?? null,
      `title:${session.id}`,
      session.updatedMs - 1000,
      session.updatedMs,
      session.taskType ?? 'interactive',
      session.archivedMs ?? null,
    )

    if (session.usage) {
      insertTurn.run(
        session.id,
        session.updatedMs - 500,
        session.usage.lastMs ?? session.updatedMs,
        session.usage.input ?? 0,
        session.usage.output ?? 0,
        session.usage.total ?? 0,
      )
    }

    session.models?.forEach((model, index) => insertModel.run(session.id, model, session.updatedMs - 900 + index))

    session.messages?.forEach((message, index) => {
      const messageId = `msg_${session.id}_${index}`
      insertMessage.run(messageId, session.id, index, JSON.stringify({
        role: message.role,
        time: { created: message.createdMs },
      }))
      const parts = message.parts ?? [{ type: 'text', text: message.text }]
      parts.forEach((part, partIndex) => {
        insertPart.run(`${messageId}_${partIndex}`, messageId, session.id, partIndex, JSON.stringify(part))
      })
    })
  }
}
