import { getDatabase } from './db'
import { logger } from './logger'

export interface MemoryEntry<T = any> {
  key: string
  value: T
  project_slug?: string
  actor: string
  updated_at: number
}

/**
 * Shared Tactical Memory for AI Agents.
 * Allows agents to store and retrieve contextual data across sessions.
 */
export const sovereignMemory = {
  /**
   * Set a tactical memory entry.
   */
  set: <T>(key: string, value: T, projectSlug?: string, actor: string = 'AEGIS'): boolean => {
    try {
      const db = getDatabase()
      const now = Math.floor(Date.now() / 1000)
      const valJson = JSON.stringify(value)

      db.prepare(`
        INSERT INTO sovereign_memory (key, value, project_slug, actor, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          project_slug = excluded.project_slug,
          actor = excluded.actor,
          updated_at = excluded.updated_at
      `).run(key, valJson, projectSlug || null, actor, now)

      return true
    } catch (err) {
      logger.error({ err, key }, 'Failed to set sovereign memory')
      return false
    }
  },

  /**
   * Get a tactical memory entry.
   */
  get: <T>(key: string): T | null => {
    try {
      const db = getDatabase()
      const row = db.prepare('SELECT value FROM sovereign_memory WHERE key = ?').get(key) as { value: string } | undefined
      
      if (!row) return null
      return JSON.parse(row.value) as T
    } catch (err) {
      logger.error({ err, key }, 'Failed to get sovereign memory')
      return null
    }
  },

  /**
   * List memory for a specific project.
   */
  listByProject: (projectSlug: string): MemoryEntry[] => {
    try {
      const db = getDatabase()
      const rows = db.prepare('SELECT * FROM sovereign_memory WHERE project_slug = ?').all(projectSlug) as any[]
      
      return rows.map(r => ({
        ...r,
        value: JSON.parse(r.value)
      }))
    } catch (err) {
      logger.error({ err, projectSlug }, 'Failed to list sovereign memory')
      return []
    }
  },

  /**
   * Clear old tactical context.
   */
  prune: (olderThanSeconds: number): number => {
    try {
      const db = getDatabase()
      const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds
      const result = db.prepare('DELETE FROM sovereign_memory WHERE updated_at < ?').run(cutoff)
      return result.changes
    } catch (err) {
      logger.error({ err }, 'Failed to prune sovereign memory')
      return 0
    }
  }
}
