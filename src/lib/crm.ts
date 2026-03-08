import Database from 'better-sqlite3'
import { config } from './config'
import { existsSync } from 'fs'
import { logger } from './logger'

let crmDb: Database.Database | null = null

function getCrmDatabase(): Database.Database | null {
  if (crmDb) return crmDb
  const dbPath = config.crmDbPath
  if (!dbPath || !existsSync(dbPath)) return null
  try {
    crmDb = new Database(dbPath, { readonly: true })
    return crmDb
  } catch (err) {
    logger.error({ err }, 'Failed to open CRM database')
    return null
  }
}

export interface CrmContact {
  id: number
  name: string
  email: string | null
  phone: string | null
  company: string | null
  type: string
  warmth: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CrmContactFilters {
  type?: string
  warmth?: string
  search?: string
  limit?: number
  offset?: number
}

export function getCrmContacts(filters: CrmContactFilters) {
  const db = getCrmDatabase()
  if (!db) return { contacts: [], total: 0 }

  let query = 'SELECT * FROM contacts WHERE 1=1'
  const params: (string | number)[] = []

  if (filters.type) {
    query += ' AND type = ?'
    params.push(filters.type)
  }
  if (filters.warmth) {
    query += ' AND warmth = ?'
    params.push(filters.warmth)
  }
  if (filters.search) {
    query += ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)'
    const s = `%${filters.search}%`
    params.push(s, s, s)
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total')
  const total = (db.prepare(countQuery).get(...params) as { total: number } | undefined)?.total || 0

  query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  params.push(filters.limit || 50, filters.offset || 0)

  const contacts = db.prepare(query).all(...params) as CrmContact[]
  return { contacts, total }
}

export function getCrmContact(id: number): CrmContact | null {
  const db = getCrmDatabase()
  if (!db) return null
  return (db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as CrmContact) || null
}

export function getCrmContactTags(contactId: number): string[] {
  const db = getCrmDatabase()
  if (!db) return []
  const rows = db
    .prepare(
      'SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.entity_id = ?'
    )
    .all(contactId) as { name: string }[]
  return rows.map((r) => r.name)
}

export function searchCrmContacts(query: string) {
  return getCrmContacts({ search: query, limit: 20 })
}

export function getCrmStats() {
  const db = getCrmDatabase()
  if (!db) {
    return { total_contacts: 0, by_type: {}, by_warmth: {}, recent_contacts: 0 }
  }

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM contacts').get() as { total: number }
  const typeRows = db
    .prepare('SELECT type, COUNT(*) as count FROM contacts GROUP BY type')
    .all() as { type: string; count: number }[]
  const warmthRows = db
    .prepare('SELECT warmth, COUNT(*) as count FROM contacts GROUP BY warmth')
    .all() as { warmth: string; count: number }[]
  const recentRow = db
    .prepare(
      "SELECT COUNT(*) as count FROM contacts WHERE updated_at > datetime('now', '-30 days')"
    )
    .get() as { count: number }

  const by_type: Record<string, number> = {}
  for (const r of typeRows) by_type[r.type] = r.count

  const by_warmth: Record<string, number> = {}
  for (const r of warmthRows) by_warmth[r.warmth] = r.count

  return {
    total_contacts: totalRow.total,
    by_type,
    by_warmth,
    recent_contacts: recentRow.count,
  }
}
