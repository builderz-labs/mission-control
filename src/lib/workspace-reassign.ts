const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

interface SqliteDatabase {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes?: number }
  }
}

export function reassignWorkspaceRows(
  db: SqliteDatabase,
  fromWorkspaceId: number,
  toWorkspaceId: number,
  now = Math.floor(Date.now() / 1000),
): number {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all() as Array<{ name: string }>

  let moved = 0
  for (const { name } of tables) {
    if (name === 'workspaces' || !TABLE_NAME.test(name)) continue
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>
    if (!cols.some((col) => col.name === 'workspace_id')) continue
    const hasUpdated = cols.some((col) => col.name === 'updated_at')
    const result = hasUpdated
      ? db.prepare(`UPDATE ${name} SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?`)
        .run(toWorkspaceId, now, fromWorkspaceId)
      : db.prepare(`UPDATE ${name} SET workspace_id = ? WHERE workspace_id = ?`)
        .run(toWorkspaceId, fromWorkspaceId)
    moved += Number(result.changes || 0)
  }
  return moved
}
