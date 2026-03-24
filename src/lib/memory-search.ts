/**
 * FTS5 full-text search for the memory filesystem.
 *
 * Uses SQLite's built-in FTS5 extension to provide ranked, tokenized search
 * across all markdown/text files in the memory directory. Replaces the brute-force
 * substring matching with proper BM25-ranked results, snippet extraction,
 * prefix queries, and boolean operators.
 *
 * The index is stored in the main MC database alongside other tables.
 * Files are indexed on-demand (first search or explicit rebuild).
 */

import type Database from 'better-sqlite3'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDatabase } from '@/lib/db'
import { scanMemoryFiles, type MemoryFileInfo } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

// ─── Schema ──────────────────────────────────────────────────────

export function ensureFtsTable(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      path,
      title,
      content,
      tokenize='porter unicode61'
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_fts_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)
}

// ─── Index management ────────────────────────────────────────────

function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)/m)
  if (h1Match) return h1Match[1].trim()
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/title:\s*(.+)/)
    if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  return filename.replace(/\.(md|txt)$/, '').replace(/[-_]/g, ' ')
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

export async function rebuildIndex(baseDir: string, allowedPrefixes: string[]): Promise<{ indexed: number; duration: number }> {
  const start = Date.now()
  const db = getDatabase()
  ensureFtsTable(db)

  const files: MemoryFileInfo[] = []
  if (allowedPrefixes.length) {
    for (const prefix of allowedPrefixes) {
      const folder = prefix.replace(/\/$/, '')
      const fullPath = join(baseDir, folder)
      if (!existsSync(fullPath)) continue
      const prefixFiles = await scanMemoryFiles(fullPath, { extensions: ['.md', '.txt'] })
      for (const f of prefixFiles) {
        files.push({ ...f, path: join(folder, f.path) })
      }
    }
  } else {
    files.push(...await scanMemoryFiles(baseDir, { extensions: ['.md', '.txt'] }))
  }

  const insertStmt = db.prepare('INSERT INTO memory_fts (path, title, content) VALUES (?, ?, ?)')

  let indexed = 0
  db.transaction(() => {
    db.exec('DELETE FROM memory_fts')

    for (const file of files) {
      try {
        const content = readFileSync(join(baseDir, file.path), 'utf-8')
        const title = extractTitle(content, file.name)
        const body = stripFrontmatter(content)
        insertStmt.run(file.path, title, body)
        indexed++
      } catch {
        // Skip unreadable files
      }
    }

    db.prepare(
      'INSERT OR REPLACE INTO memory_fts_meta (key, value) VALUES (?, ?)'
    ).run('last_rebuild', new Date().toISOString())
    db.prepare(
      'INSERT OR REPLACE INTO memory_fts_meta (key, value) VALUES (?, ?)'
    ).run('file_count', String(indexed))
  })()

  const duration = Date.now() - start
  logger.info({ indexed, duration }, 'Memory FTS index rebuilt')
  return { indexed, duration }
}

/**
 * Index a single file (for incremental updates after saves).
 */
export function indexFile(db: Database.Database, baseDir: string, relativePath: string): void {
  ensureFtsTable(db)
  try {
    const content = readFileSync(join(baseDir, relativePath), 'utf-8')
    const name = relativePath.split('/').pop() || relativePath
    const title = extractTitle(content, name)
    const body = stripFrontmatter(content)

    db.transaction(() => {
      db.prepare('DELETE FROM memory_fts WHERE path = ?').run(relativePath)
      db.prepare('INSERT INTO memory_fts (path, title, content) VALUES (?, ?, ?)').run(relativePath, title, body)
    })()
  } catch (err) {
    logger.warn({ err, path: relativePath }, 'Failed to index file for FTS')
  }
}

/**
 * Remove a file from the index.
 */
export function removeFromIndex(db: Database.Database, relativePath: string): void {
  try {
    db.prepare('DELETE FROM memory_fts WHERE path = ?').run(relativePath)
  } catch {
    // Index may not exist yet
  }
}

// ─── Search ──────────────────────────────────────────────────────

export interface SearchResult {
  path: string
  title: string
  snippet: string
  rank: number
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
  indexedFiles: number
  indexedAt: string | null
}

async function ensureIndex(baseDir: string, allowedPrefixes: string[]): Promise<void> {
  const db = getDatabase()
  ensureFtsTable(db)

  const meta = db.prepare(
    "SELECT value FROM memory_fts_meta WHERE key = 'last_rebuild'"
  ).get() as { value: string } | undefined

  if (!meta) {
    await rebuildIndex(baseDir, allowedPrefixes)
  }
}

export async function searchMemory(
  baseDir: string,
  allowedPrefixes: string[],
  query: string,
  opts?: { limit?: number }
): Promise<SearchResponse> {
  await ensureIndex(baseDir, allowedPrefixes)

  const db = getDatabase()
  const limit = opts?.limit ?? 20

  const sanitized = sanitizeFtsQuery(query)

  let results: SearchResult[] = []
  let total = 0

  try {
    const rows = db.prepare(`
      SELECT
        path,
        title,
        snippet(memory_fts, 2, '<mark>', '</mark>', '...', 40) as snippet,
        bm25(memory_fts, 1.0, 5.0, 1.0) as rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit) as Array<{ path: string; title: string; snippet: string; rank: number }>

    results = rows.map((r) => ({
      path: r.path,
      title: r.title,
      snippet: r.snippet,
      rank: Math.abs(r.rank),
    }))

    const countRow = db.prepare(
      'SELECT count(*) as cnt FROM memory_fts WHERE memory_fts MATCH ?'
    ).get(sanitized) as { cnt: number }
    total = countRow.cnt
  } catch (err) {
    logger.warn({ err, query: sanitized }, 'FTS5 query failed, falling back to phrase search')
    try {
      const fallbackQuery = `"${query.replace(/"/g, '""')}"`
      const rows = db.prepare(`
        SELECT path, title,
          snippet(memory_fts, 2, '<mark>', '</mark>', '...', 40) as snippet,
          bm25(memory_fts, 1.0, 5.0, 1.0) as rank
        FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?
      `).all(fallbackQuery, limit) as Array<{ path: string; title: string; snippet: string; rank: number }>
      results = rows.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet, rank: Math.abs(r.rank) }))
      total = results.length
    } catch {
      // Return empty on total failure
    }
  }

  const meta = db.prepare(
    "SELECT value FROM memory_fts_meta WHERE key = 'last_rebuild'"
  ).get() as { value: string } | undefined
  const fileCountMeta = db.prepare(
    "SELECT value FROM memory_fts_meta WHERE key = 'file_count'"
  ).get() as { value: string } | undefined

  return {
    query,
    results,
    total,
    indexedFiles: fileCountMeta ? Number(fileCountMeta.value) : 0,
    indexedAt: meta?.value ?? null,
  }
}

/**
 * Sanitize a user query for FTS5 syntax.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return '""'

  // If user is already using FTS5 operators, pass through
  if (/\b(AND|OR|NOT|NEAR)\b/.test(trimmed) || trimmed.includes('"')) {
    return trimmed
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    return `${words[0]}*`
  }

  // Multiple words — prefix matching with implicit AND
  return words.map((w) => `${w}*`).join(' ')
}
