import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabase } from '@/lib/db'
import { JevRecordError, assertJevProject } from '@/lib/jev-repository'
import { resolveJevCreatorUserId } from '@/lib/jev-session-access'
import {
  redactJevSetupText,
  serializeRedactedJevSetupValue,
} from '@/lib/jev-setup-redaction'
import type {
  JevSetupMessage,
  JevSetupRevision,
  JevSetupSession,
} from '@/lib/jev-setup-session-types'
import type {
  CreateJevSetupSessionInput,
  UpdateJevSetupSessionInput,
} from '@/lib/jev-setup-session-validation'

type Db = Database.Database

function assertPolicyScope(
  workspaceId: number,
  projectId: number,
  policyId: number | null | undefined,
  db: Db,
): void {
  if (policyId == null) return
  const row = db.prepare(`
    SELECT id FROM jev_policies
    WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
  `).get(policyId, workspaceId, projectId)
  if (!row) throw new JevRecordError('Jev policy not found', 404)
}

function parseRevision(row: Record<string, unknown>): JevSetupRevision {
  return {
    ...(row as unknown as JevSetupRevision),
    draft: JSON.parse(String(row.draft)),
    configuration: JSON.parse(String(row.configuration)),
  }
}

export function createJevSetupSession(
  input: CreateJevSetupSessionInput,
  scope: { workspaceId: number; tenantId: number; userId: number; principal?: string },
  db: Db = getDatabase(),
): JevSetupSession {
  assertJevProject(scope.workspaceId, scope.tenantId, input.projectId, db)
  assertPolicyScope(scope.workspaceId, input.projectId, input.primaryPolicyId, db)
  const creatorUserId = resolveJevCreatorUserId(scope.workspaceId, scope.userId, db)
  if (!creatorUserId) throw new JevRecordError('A workspace user is required to create a session', 409)
  const id = randomUUID()
  db.prepare(`
    INSERT INTO jev_setup_sessions
      (id, workspace_id, project_id, created_by_user_id, created_by_principal,
       title, provider, model, primary_policy_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scope.workspaceId, input.projectId, creatorUserId,
    scope.principal ?? `user:${scope.userId}`,
    redactJevSetupText(input.title), input.provider, input.model, input.primaryPolicyId ?? null)
  return getJevSetupSession(id, scope.workspaceId, scope.tenantId, db)
}

export function listJevSetupSessions(
  workspaceId: number,
  tenantId: number,
  options: { projectId?: number; includeArchived?: boolean; limit?: number; offset?: number } = {},
  db: Db = getDatabase(),
): JevSetupSession[] {
  const clauses = ['s.workspace_id = ?', 'w.tenant_id = ?']
  const values: Array<number | string> = [workspaceId, tenantId]
  if (options.projectId) {
    clauses.push('s.project_id = ?')
    values.push(options.projectId)
  }
  if (!options.includeArchived) clauses.push("s.status != 'archived'")
  values.push(Math.min(options.limit ?? 50, 100), options.offset ?? 0)
  return db.prepare(`
    SELECT s.* FROM jev_setup_sessions s
    JOIN workspaces w ON w.id = s.workspace_id
    JOIN projects p ON p.id = s.project_id AND p.workspace_id = s.workspace_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?
  `).all(...values) as JevSetupSession[]
}

export function getJevSetupSession(
  id: string,
  workspaceId: number,
  tenantId: number,
  db: Db = getDatabase(),
): JevSetupSession {
  const row = db.prepare(`
    SELECT s.* FROM jev_setup_sessions s
    JOIN workspaces w ON w.id = s.workspace_id
    JOIN projects p ON p.id = s.project_id AND p.workspace_id = s.workspace_id
    WHERE s.id = ? AND s.workspace_id = ? AND w.tenant_id = ? LIMIT 1
  `).get(id, workspaceId, tenantId) as JevSetupSession | undefined
  if (!row) throw new JevRecordError('Jev setup session not found', 404)
  return row
}

export function updateJevSetupSession(
  session: JevSetupSession,
  updates: UpdateJevSetupSessionInput,
  db: Db = getDatabase(),
): JevSetupSession {
  assertPolicyScope(session.workspace_id, session.project_id, updates.primaryPolicyId, db)
  const next = {
    title: updates.title ? redactJevSetupText(updates.title) : session.title,
    provider: updates.provider ?? session.provider,
    model: updates.model ?? session.model,
    status: updates.status ?? session.status,
    policyId: updates.primaryPolicyId === undefined
      ? session.primary_policy_id : updates.primaryPolicyId,
  }
  db.prepare(`
    UPDATE jev_setup_sessions SET title=?, provider=?, model=?, status=?,
      primary_policy_id=?, updated_at=unixepoch()
    WHERE id=? AND workspace_id=?
  `).run(next.title, next.provider, next.model, next.status, next.policyId,
    session.id, session.workspace_id)
  return db.prepare('SELECT * FROM jev_setup_sessions WHERE id=? AND workspace_id=?')
    .get(session.id, session.workspace_id) as JevSetupSession
}

export function archiveJevSetupSession(session: JevSetupSession, db: Db = getDatabase()): JevSetupSession {
  db.prepare(`
    UPDATE jev_setup_sessions SET status='archived', archived_at=unixepoch(), updated_at=unixepoch()
    WHERE id=? AND workspace_id=?
  `).run(session.id, session.workspace_id)
  return db.prepare('SELECT * FROM jev_setup_sessions WHERE id=? AND workspace_id=?')
    .get(session.id, session.workspace_id) as JevSetupSession
}

export function listJevSetupMessages(
  session: JevSetupSession,
  limit = 100,
  afterOrdinal = 0,
  db: Db = getDatabase(),
): JevSetupMessage[] {
  return db.prepare(`
    SELECT * FROM jev_setup_messages
    WHERE workspace_id=? AND session_id=? AND ordinal>?
    ORDER BY ordinal ASC LIMIT ?
  `).all(session.workspace_id, session.id, afterOrdinal, Math.min(limit, 200)) as JevSetupMessage[]
}

export function getLatestJevSetupRevision(
  session: JevSetupSession,
  db: Db = getDatabase(),
): JevSetupRevision | null {
  const row = db.prepare(`
    SELECT * FROM jev_setup_revisions WHERE workspace_id=? AND session_id=?
    ORDER BY revision_no DESC LIMIT 1
  `).get(session.workspace_id, session.id) as Record<string, unknown> | undefined
  return row ? parseRevision(row) : null
}

export function appendJevSetupExchange(
  session: JevSetupSession,
  exchange: { user: unknown; assistant: unknown; draft: unknown; configuration: unknown; provider: string; model: string },
  db: Db = getDatabase(),
): JevSetupRevision {
  return db.transaction(() => {
    const next = db.prepare(`
      SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM jev_setup_messages
      WHERE workspace_id=? AND session_id=?
    `).get(session.workspace_id, session.id) as { ordinal: number }
    const insertMessage = db.prepare(`
      INSERT INTO jev_setup_messages
        (workspace_id,session_id,ordinal,role,content,provider,model)
      VALUES (?,?,?,?,?,?,?)
    `)
    insertMessage.run(session.workspace_id, session.id, next.ordinal, 'user',
      serializeRedactedJevSetupValue(exchange.user), null, null)
    insertMessage.run(session.workspace_id, session.id, next.ordinal + 1, 'assistant',
      serializeRedactedJevSetupValue(exchange.assistant), exchange.provider, exchange.model)
    const revision = db.prepare(`
      INSERT INTO jev_setup_revisions
        (workspace_id,session_id,revision_no,draft,configuration,provider,model)
      SELECT ?, ?, COALESCE(MAX(revision_no), 0) + 1, ?, ?, ?, ?
      FROM jev_setup_revisions WHERE workspace_id=? AND session_id=?
    `).run(session.workspace_id, session.id,
      serializeRedactedJevSetupValue(exchange.draft),
      serializeRedactedJevSetupValue(exchange.configuration), exchange.provider, exchange.model,
      session.workspace_id, session.id)
    db.prepare(`
      UPDATE jev_setup_sessions SET provider=?, model=?, updated_at=unixepoch()
      WHERE id=? AND workspace_id=?
    `).run(exchange.provider, exchange.model, session.id, session.workspace_id)
    const row = db.prepare('SELECT * FROM jev_setup_revisions WHERE id=?')
      .get(Number(revision.lastInsertRowid)) as Record<string, unknown>
    return parseRevision(row)
  })()
}
