import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

/** Optional read-only title lookup. Older CLI versions need only the JSONL fallback. */
export function readCodexThreadNames(homeDir: string): Map<string, string> {
  const names = new Map<string, string>()
  const root = join(homeDir, '.codex')
  let db: Database.Database | null = null
  try {
    const file = readdirSync(root)
      .filter((name) => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))[0]
    if (!file) return names
    db = new Database(join(root, file), { readonly: true, fileMustExist: true, timeout: 100 })
    const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map((row) => row.name))
    if (!columns.has('id') || !columns.has('title')) return names
    const display = columns.has('name') ? "COALESCE(NULLIF(name, ''), title)" : 'title'
    const order = columns.has('updated_at') ? 'ORDER BY updated_at DESC' : ''
    const rows = db.prepare(`SELECT id, ${display} AS title FROM threads ${order} LIMIT 1000`).all() as Array<{ id: string; title: string | null }>
    for (const row of rows) {
      if (row.title?.trim()) names.set(row.id, row.title.trim().replace(/\s+/g, ' ').slice(0, 120))
    }
  } catch {
    // The index is optional, can be locked, and its schema is owned by Codex.
  } finally {
    db?.close()
  }
  return names
}
