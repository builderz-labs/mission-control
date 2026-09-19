import { getDatabase } from '@/lib/db'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { fleetAgentFromWorkspace } from '@/lib/fleet-agents'
import { scanGrokSessions } from '@/lib/grok-sessions'
import { scanKimiSessions } from '@/lib/kimi-sessions'
import { logger } from '@/lib/logger'

const RUNTIME_PREFIX = /^(grok|kimi|codex|hermes|opencode):/

interface RuntimeRow {
  sessionId: string
  projectSlug: string
  projectPath: string | null
  model: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastUserPrompt?: string | null
  isActive: boolean
}

function prefixed(source: string, sessionId: string): string {
  return sessionId.startsWith(`${source}:`) ? sessionId : `${source}:${sessionId}`
}

function agentFor(sessionId: string, projectPath: string | null): string {
  if (sessionId.startsWith('grok:')) return 'grok'
  if (sessionId.startsWith('kimi:')) return 'kimi'
  if (sessionId.startsWith('codex:')) return 'codex'
  return fleetAgentFromWorkspace(projectPath)
}

function epoch(value: string | null, fallback: number): number {
  if (!value) return fallback
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= 0) return fallback
  return Math.floor(ms / 1000)
}

export function shouldKeepExternalSession(sessionId: string): boolean {
  return RUNTIME_PREFIX.test(sessionId)
}

export function persistRuntimeSessions(): { upserted: number } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const rows: Array<{ source: string; row: RuntimeRow }> = [
    ...scanGrokSessions().map((row) => ({ source: 'grok', row })),
    ...scanKimiSessions().map((row) => ({ source: 'kimi', row })),
    ...scanCodexSessions().map((row) => ({ source: 'codex', row })),
  ]
  const upsert = db.prepare(`
    INSERT INTO claude_sessions (
      session_id, project_slug, project_path, model, git_branch,
      user_messages, assistant_messages, tool_uses,
      input_tokens, output_tokens, estimated_cost,
      first_message_at, last_message_at, last_user_prompt,
      is_active, scanned_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      project_slug = excluded.project_slug,
      project_path = excluded.project_path,
      model = excluded.model,
      user_messages = excluded.user_messages,
      assistant_messages = excluded.assistant_messages,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      last_message_at = excluded.last_message_at,
      last_user_prompt = excluded.last_user_prompt,
      is_active = excluded.is_active,
      scanned_at = excluded.scanned_at,
      updated_at = excluded.updated_at
  `)
  db.transaction(() => {
    for (const item of rows) {
      const sessionId = prefixed(item.source, item.row.sessionId)
      upsert.run(
        sessionId,
        item.row.projectSlug,
        item.row.projectPath,
        item.row.model,
        item.row.userMessages,
        item.row.assistantMessages,
        item.row.inputTokens,
        item.row.outputTokens,
        item.row.firstMessageAt,
        item.row.lastMessageAt,
        item.row.lastUserPrompt ?? null,
        item.row.isActive ? 1 : 0,
        now,
        now,
      )
    }
  })()
  return { upserted: rows.length }
}

export function backfillTokenUsage(workspaceId = 1): { inserted: number } {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO token_usage (
      model, session_id, input_tokens, output_tokens, created_at, workspace_id, cost_usd, agent_name
    )
    SELECT
      COALESCE(NULLIF(s.model, ''), 'unknown'),
      s.session_id,
      s.input_tokens,
      s.output_tokens,
      COALESCE(
        CAST(strftime('%s', replace(substr(s.last_message_at, 1, 19), 'T', ' ')) AS INTEGER),
        s.scanned_at,
        s.created_at,
        CAST(strftime('%s', 'now') AS INTEGER)
      ),
      ?,
      s.estimated_cost,
      CASE
        WHEN s.session_id LIKE 'grok:%' THEN 'grok'
        WHEN s.session_id LIKE 'kimi:%' THEN 'kimi'
        WHEN s.session_id LIKE 'codex:%' THEN 'codex'
        WHEN IFNULL(s.project_path, '') LIKE '%workspace-claude-20x%'
          OR IFNULL(s.project_path, '') LIKE '%workspace-claude-1%'
          OR IFNULL(s.project_path, '') LIKE '%.claude-account1%' THEN 'claude-1'
        WHEN IFNULL(s.project_path, '') LIKE '%workspace-claude-5x%'
          OR IFNULL(s.project_path, '') LIKE '%workspace-claude-2%'
          OR IFNULL(s.project_path, '') LIKE '%.claude-account2%' THEN 'claude-2'
        ELSE 'claude-1'
      END
    FROM claude_sessions s
    WHERE NOT EXISTS (
      SELECT 1 FROM token_usage t WHERE t.session_id = s.session_id AND t.workspace_id = ?
    )
  `).run(workspaceId, workspaceId)
  logger.info({ inserted: result.changes }, 'Backfilled token_usage from session history')
  return { inserted: result.changes }
}

export function agentNameForSession(sessionId: string, projectPath: string | null): string {
  return agentFor(sessionId, projectPath)
}

export async function syncRuntimeHistory(
  claudeSync: (force?: boolean) => Promise<{ ok: boolean; message: string }>,
  force = false,
): Promise<{ ok: boolean; message: string }> {
  const claude = await claudeSync(force)
  const extra = persistRuntimeSessions()
  const usage = backfillTokenUsage()
  return {
    ok: claude.ok,
    message: `${claude.message}; extra ${extra.upserted}; token_usage +${usage.inserted}`,
  }
}
