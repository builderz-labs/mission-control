import type Database from 'better-sqlite3'

const RENAMES = [
  { from: 'claude-20x', to: 'claude-1' },
  { from: 'claude-5x', to: 'claude-2' },
] as const

const NAME_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'tasks', column: 'assigned_to' },
  { table: 'task_subscriptions', column: 'agent_name' },
  { table: 'messages', column: 'from_agent' },
  { table: 'messages', column: 'to_agent' },
  { table: 'token_usage', column: 'agent_name' },
  { table: 'security_events', column: 'agent_name' },
  { table: 'agent_trust_scores', column: 'agent_name' },
  { table: 'mcp_call_log', column: 'agent_name' },
  { table: 'eval_runs', column: 'agent_name' },
  { table: 'eval_traces', column: 'agent_name' },
  { table: 'spawn_history', column: 'agent_name' },
  { table: 'runs', column: 'agent_name' },
]

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  )
}

function rewriteAgentConfig(raw: string | null, from: string, to: string): string | null {
  if (!raw) return raw
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.openclawId === from) parsed.openclawId = to
    const identity = parsed.identity
    if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
      const rec = identity as Record<string, unknown>
      if (rec.name === from) rec.name = to
      if (typeof rec.content === 'string') rec.content = rec.content.split(from).join(to)
    }
    return JSON.stringify(parsed)
  } catch {
    return raw
  }
}

function renameAgentTable(db: Database.Database, from: string, to: string): void {
  if (!hasTable(db, 'agents')) return
  const rows = db.prepare('SELECT id, workspace_id, config FROM agents WHERE name = ?').all(from) as Array<{
    id: number
    workspace_id: number
    config: string | null
  }>
  const findTarget = db.prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?')
  const hide = db.prepare('UPDATE agents SET hidden = 1, config = ? WHERE id = ?')
  const reveal = db.prepare('UPDATE agents SET hidden = 0 WHERE id = ?')
  const rename = db.prepare('UPDATE agents SET name = ?, hidden = 0, config = ? WHERE id = ?')
  for (const row of rows) {
    const config = rewriteAgentConfig(row.config, from, to)
    const existing = findTarget.get(to, row.workspace_id) as { id: number } | undefined
    if (existing) {
      hide.run(config, row.id)
      reveal.run(existing.id)
    } else {
      rename.run(to, config, row.id)
    }
  }
}

function renameProjectAssignments(db: Database.Database, from: string, to: string): void {
  if (!hasTable(db, 'project_agent_assignments')) return
  const rows = db.prepare(
    'SELECT id, project_id FROM project_agent_assignments WHERE agent_name = ?',
  ).all(from) as Array<{ id: number; project_id: number }>
  const findTarget = db.prepare(
    'SELECT id FROM project_agent_assignments WHERE project_id = ? AND agent_name = ?',
  )
  const del = db.prepare('DELETE FROM project_agent_assignments WHERE id = ?')
  const upd = db.prepare('UPDATE project_agent_assignments SET agent_name = ? WHERE id = ?')
  for (const row of rows) {
    const existing = findTarget.get(row.project_id, to)
    if (existing) del.run(row.id)
    else upd.run(to, row.id)
  }
}

function renameLooseColumns(db: Database.Database, from: string, to: string): void {
  for (const { table, column } of NAME_COLUMNS) {
    if (!hasTable(db, table)) continue
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from)
  }
}

export function renameClaudeFleetAgentRows(db: Database.Database): void {
  for (const { from, to } of RENAMES) {
    renameAgentTable(db, from, to)
    renameProjectAssignments(db, from, to)
    renameLooseColumns(db, from, to)
  }
}
