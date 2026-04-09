// Search engine backed by SQLite FTS5 with keyword fallback.
// FTS5 tables are created lazily — safe to call on any DB that has the base tables.

import type { Database } from 'better-sqlite3'

export type SearchEntityType = 'agent' | 'task' | 'memory' | 'activity' | 'alert'

export interface SearchResult {
  readonly id: number
  readonly entityType: SearchEntityType
  readonly title: string
  readonly excerpt: string        // ≤120-char excerpt; match context highlighted inline
  readonly metadata: Record<string, unknown>
  readonly score: number          // FTS rank or 1.0 fallback
  readonly created_at: number
}

export interface SearchResponse {
  readonly query: string
  readonly results: SearchResult[]
  readonly totalHits: number
  readonly durationMs: number
  readonly engine: 'fts5' | 'keyword'
}

// ---------------------------------------------------------------------------
// Internal row shapes per entity type
// ---------------------------------------------------------------------------

interface TaskRow {
  id: number; title: string; description: string | null
  status: string; workspace_id: number; created_at: number
}
interface AgentRow {
  id: number; name: string; role: string
  status: string; workspace_id: number; created_at: number
}
interface ActivityRow {
  id: number; description: string; type: string
  actor: string; workspace_id: number; created_at: number
}
interface PatternRow {
  id: number; trigger_context: string; action_taken: string
  pattern_type: string; workspace_id: number; created_at: number
}
interface AlertRow {
  id: number; name: string; description: string | null
  entity_type: string; created_at: number
}

// ---------------------------------------------------------------------------
// Excerpt helper
// ---------------------------------------------------------------------------

/** Returns ≤120-char excerpt centred around the first match of `query`. */
function buildExcerpt(text: string | null, query: string): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 120) + (text.length > 120 ? '...' : '')
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + query.length + 80)
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
}

// ---------------------------------------------------------------------------
// FTS5 table setup helpers
// ---------------------------------------------------------------------------

/** Attempt to create one FTS5 virtual table. Returns true on success. */
function ensureFtsTable(db: Database, ddl: string): boolean {
  try {
    db.exec(ddl)
    return true
  } catch {
    return false
  }
}

function ensureAllFtsTables(db: Database): boolean {
  const ok = [
    ensureFtsTable(db, `CREATE VIRTUAL TABLE IF NOT EXISTS fts_tasks
      USING fts5(title, description, content='tasks', content_rowid='id')`),
    ensureFtsTable(db, `CREATE VIRTUAL TABLE IF NOT EXISTS fts_agents
      USING fts5(name, role, content='agents', content_rowid='id')`),
    ensureFtsTable(db, `CREATE VIRTUAL TABLE IF NOT EXISTS fts_activities
      USING fts5(description, type, content='activities', content_rowid='id')`),
    ensureFtsTable(db, `CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories
      USING fts5(trigger_context, action_taken, content='learned_patterns', content_rowid='id')`),
    ensureFtsTable(db, `CREATE VIRTUAL TABLE IF NOT EXISTS fts_alert_rules
      USING fts5(name, description, content='alert_rules', content_rowid='id')`),
  ]
  // All must succeed for FTS mode to be reliable
  return ok.every(Boolean)
}

// ---------------------------------------------------------------------------
// Per-entity search helpers
// ---------------------------------------------------------------------------

function searchTasks(
  db: Database, query: string, workspaceId: number, limit: number, useFts: boolean,
): SearchResult[] {
  const results: SearchResult[] = []
  try {
    if (useFts) {
      const rows = db.prepare(`
        SELECT t.id, t.title, t.description, t.status, t.workspace_id, t.created_at,
               fts_tasks.rank AS rank
        FROM fts_tasks
        JOIN tasks t ON fts_tasks.rowid = t.id
        WHERE fts_tasks MATCH ? AND t.workspace_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, workspaceId, limit) as (TaskRow & { rank: number })[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'task',
          title: r.title, excerpt: buildExcerpt(r.description, query),
          metadata: { status: r.status },
          score: Math.abs(r.rank), created_at: r.created_at,
        })
      }
    } else {
      const like = `%${query}%`
      const rows = db.prepare(`
        SELECT id, title, description, status, workspace_id, created_at
        FROM tasks WHERE workspace_id = ? AND (title LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, like, like, limit) as TaskRow[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'task',
          title: r.title, excerpt: buildExcerpt(r.description, query),
          metadata: { status: r.status }, score: 1.0, created_at: r.created_at,
        })
      }
    }
  } catch { /* table absent — return empty */ }
  return results
}

function searchAgents(
  db: Database, query: string, workspaceId: number, limit: number, useFts: boolean,
): SearchResult[] {
  const results: SearchResult[] = []
  try {
    if (useFts) {
      const rows = db.prepare(`
        SELECT a.id, a.name, a.role, a.status, a.workspace_id, a.created_at,
               fts_agents.rank AS rank
        FROM fts_agents
        JOIN agents a ON fts_agents.rowid = a.id
        WHERE fts_agents MATCH ? AND a.workspace_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, workspaceId, limit) as (AgentRow & { rank: number })[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'agent',
          title: r.name, excerpt: buildExcerpt(r.role, query),
          metadata: { role: r.role, status: r.status },
          score: Math.abs(r.rank), created_at: r.created_at,
        })
      }
    } else {
      const like = `%${query}%`
      const rows = db.prepare(`
        SELECT id, name, role, status, workspace_id, created_at
        FROM agents WHERE workspace_id = ? AND (name LIKE ? OR role LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, like, like, limit) as AgentRow[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'agent',
          title: r.name, excerpt: buildExcerpt(r.role, query),
          metadata: { role: r.role, status: r.status },
          score: 1.0, created_at: r.created_at,
        })
      }
    }
  } catch { /* table absent */ }
  return results
}

function searchActivities(
  db: Database, query: string, workspaceId: number, limit: number, useFts: boolean,
): SearchResult[] {
  const results: SearchResult[] = []
  try {
    if (useFts) {
      const rows = db.prepare(`
        SELECT a.id, a.description, a.type, a.actor, a.workspace_id, a.created_at,
               fts_activities.rank AS rank
        FROM fts_activities
        JOIN activities a ON fts_activities.rowid = a.id
        WHERE fts_activities MATCH ? AND a.workspace_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, workspaceId, limit) as (ActivityRow & { rank: number })[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'activity',
          title: r.description, excerpt: buildExcerpt(r.description, query),
          metadata: { type: r.type, actor: r.actor },
          score: Math.abs(r.rank), created_at: r.created_at,
        })
      }
    } else {
      const like = `%${query}%`
      const rows = db.prepare(`
        SELECT id, description, type, actor, workspace_id, created_at
        FROM activities WHERE workspace_id = ? AND (description LIKE ? OR actor LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, like, like, limit) as ActivityRow[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'activity',
          title: r.description, excerpt: buildExcerpt(r.description, query),
          metadata: { type: r.type, actor: r.actor },
          score: 1.0, created_at: r.created_at,
        })
      }
    }
  } catch { /* table absent */ }
  return results
}

function searchMemories(
  db: Database, query: string, workspaceId: number, limit: number, useFts: boolean,
): SearchResult[] {
  const results: SearchResult[] = []
  try {
    if (useFts) {
      const rows = db.prepare(`
        SELECT p.id, p.trigger_context, p.action_taken, p.pattern_type, p.workspace_id, p.created_at,
               fts_memories.rank AS rank
        FROM fts_memories
        JOIN learned_patterns p ON fts_memories.rowid = p.id
        WHERE fts_memories MATCH ? AND p.workspace_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, workspaceId, limit) as (PatternRow & { rank: number })[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'memory',
          title: r.trigger_context, excerpt: buildExcerpt(r.action_taken, query),
          metadata: { pattern_type: r.pattern_type },
          score: Math.abs(r.rank), created_at: r.created_at,
        })
      }
    } else {
      const like = `%${query}%`
      const rows = db.prepare(`
        SELECT id, trigger_context, action_taken, pattern_type, workspace_id, created_at
        FROM learned_patterns
        WHERE workspace_id = ? AND (trigger_context LIKE ? OR action_taken LIKE ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(workspaceId, like, like, limit) as PatternRow[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'memory',
          title: r.trigger_context, excerpt: buildExcerpt(r.action_taken, query),
          metadata: { pattern_type: r.pattern_type },
          score: 1.0, created_at: r.created_at,
        })
      }
    }
  } catch { /* table absent */ }
  return results
}

function searchAlerts(
  db: Database, query: string, limit: number, useFts: boolean,
): SearchResult[] {
  const results: SearchResult[] = []
  try {
    if (useFts) {
      const rows = db.prepare(`
        SELECT a.id, a.name, a.description, a.entity_type, a.created_at,
               fts_alert_rules.rank AS rank
        FROM fts_alert_rules
        JOIN alert_rules a ON fts_alert_rules.rowid = a.id
        WHERE fts_alert_rules MATCH ?
        ORDER BY rank LIMIT ?
      `).all(query, limit) as (AlertRow & { rank: number })[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'alert',
          title: r.name, excerpt: buildExcerpt(r.description, query),
          metadata: { entity_type: r.entity_type },
          score: Math.abs(r.rank), created_at: r.created_at,
        })
      }
    } else {
      const like = `%${query}%`
      const rows = db.prepare(`
        SELECT id, name, description, entity_type, created_at
        FROM alert_rules WHERE name LIKE ? OR description LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(like, like, limit) as AlertRow[]
      for (const r of rows) {
        results.push({
          id: r.id, entityType: 'alert',
          title: r.name, excerpt: buildExcerpt(r.description, query),
          metadata: { entity_type: r.entity_type },
          score: 1.0, created_at: r.created_at,
        })
      }
    }
  } catch { /* table absent */ }
  return results
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cross-entity full-text search.
 * Tries FTS5 first; falls back to LIKE pattern matching per entity type.
 * Never throws — returns empty SearchResponse on any unrecoverable error.
 */
export function searchEntities(
  db: Database,
  query: string,
  types: SearchEntityType[],
  workspaceId: number,
  limit: number,
): SearchResponse {
  const start = Date.now()
  const accumulated: SearchResult[] = []

  try {
    const useFts = ensureAllFtsTables(db)
    // Sanitize query for FTS5 MATCH: wrap in quotes to treat as phrase
    const ftsQuery = useFts ? `"${query.replace(/"/g, '')}"` : query
    const perTypeLimit = Math.max(limit, 10)
    let engine: 'fts5' | 'keyword' = useFts ? 'fts5' : 'keyword'

    for (const type of types) {
      switch (type) {
        case 'task':
          accumulated.push(...searchTasks(db, useFts ? ftsQuery : query, workspaceId, perTypeLimit, useFts))
          break
        case 'agent':
          accumulated.push(...searchAgents(db, useFts ? ftsQuery : query, workspaceId, perTypeLimit, useFts))
          break
        case 'activity':
          accumulated.push(...searchActivities(db, useFts ? ftsQuery : query, workspaceId, perTypeLimit, useFts))
          break
        case 'memory':
          accumulated.push(...searchMemories(db, useFts ? ftsQuery : query, workspaceId, perTypeLimit, useFts))
          break
        case 'alert':
          accumulated.push(...searchAlerts(db, useFts ? ftsQuery : query, perTypeLimit, useFts))
          break
      }
    }

    // FTS5 external content tables can exist but have empty indexes when there are no
    // triggers to keep them in sync with the base tables. If FTS returned nothing,
    // retry with keyword (LIKE) search so newly-inserted rows are always findable.
    if (useFts && accumulated.length === 0) {
      engine = 'keyword'
      for (const type of types) {
        switch (type) {
          case 'task':
            accumulated.push(...searchTasks(db, query, workspaceId, perTypeLimit, false))
            break
          case 'agent':
            accumulated.push(...searchAgents(db, query, workspaceId, perTypeLimit, false))
            break
          case 'activity':
            accumulated.push(...searchActivities(db, query, workspaceId, perTypeLimit, false))
            break
          case 'memory':
            accumulated.push(...searchMemories(db, query, workspaceId, perTypeLimit, false))
            break
          case 'alert':
            accumulated.push(...searchAlerts(db, query, perTypeLimit, false))
            break
        }
      }
    }

    accumulated.sort((a, b) => b.score - a.score || b.created_at - a.created_at)
    const results = accumulated.slice(0, limit)

    return {
      query,
      results,
      totalHits: accumulated.length,
      durationMs: Date.now() - start,
      engine,
    }
  } catch {
    return {
      query, results: [], totalHits: 0,
      durationMs: Date.now() - start, engine: 'keyword',
    }
  }
}
