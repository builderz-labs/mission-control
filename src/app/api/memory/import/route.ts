import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import fs, { statSync, realpathSync } from 'node:fs'
import path from 'node:path'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/

function walkDir(dir: string, base: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relPath = path.join(base, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, relPath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relPath)
    }
  }
  return results
}

function extractTitle(content: string, filename: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  return filename.replace(/\.md$/, '')
}

function classifyFile(relPath: string): { type: string; dateRef: string | null } {
  const parts = relPath.split(path.sep)
  const filename = parts[parts.length - 1].replace(/\.md$/, '')

  const dateMatch = filename.match(DATE_PATTERN)
  if (dateMatch) {
    return { type: 'daily', dateRef: dateMatch[0] }
  }

  const folder = parts.length > 1 ? parts[0].toLowerCase() : ''
  if (folder === 'decisions') return { type: 'decision', dateRef: null }
  if (folder === 'lessons') return { type: 'lesson', dateRef: null }

  return { type: 'long_term', dateRef: null }
}

/**
 * POST /api/memory/import - Bulk-import memory from workspace markdown files
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const memoryDir = config.memoryDir

    if (!memoryDir || !fs.existsSync(memoryDir)) {
      return NextResponse.json({ error: 'Memory directory not configured or does not exist' }, { status: 400 })
    }

    const files = walkDir(memoryDir, '')
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    const checkExisting = db.prepare(
      'SELECT id FROM memory_records WHERE source_file = ? AND workspace_id = ?'
    )
    const insertStmt = db.prepare(`
      INSERT INTO memory_records (workspace_id, type, title, content, source_file, date_ref)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const importTx = db.transaction(() => {
      for (const relPath of files) {
        try {
          const existing = checkExisting.get(relPath, workspaceId)
          if (existing) {
            skipped++
            continue
          }

          const fullPath = path.join(memoryDir, relPath)

          // Symlink / path traversal guard
          const realPath = realpathSync(fullPath)
          const realBase = realpathSync(memoryDir)
          if (!realPath.startsWith(realBase + '/')) {
            skipped++
            continue
          }

          // 1 MB file size limit
          const stats = statSync(fullPath)
          if (stats.size > 1024 * 1024) {
            skipped++
            continue
          }

          const content = fs.readFileSync(fullPath, 'utf8')
          const title = extractTitle(content, path.basename(relPath))
          const { type, dateRef } = classifyFile(relPath)

          insertStmt.run(workspaceId, type, title, content, relPath, dateRef)
          imported++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`${relPath}: ${msg}`)
        }
      }
    })

    importTx()

    return NextResponse.json({ imported, skipped, errors })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/memory/import error')
    return NextResponse.json({ error: 'Failed to import memory files' }, { status: 500 })
  }
}
