import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface TodoItem {
  title: string
  source_file: string
  status: 'inbox' | 'in_progress' | 'done'
}

const MAX_IMPORT_ITEMS = 100

interface ParsedFile {
  path: string
  pending: TodoItem[]
  ongoing: TodoItem[]
  done: TodoItem[]
}

const IN_PROGRESS_HEADERS = /^#{1,4}\s+(in[ _-]?progress|doing|ongoing|wip|current)/i
const DONE_HEADERS = /^#{1,4}\s+(done|completed|finished|closed)/i

/** Parse a todo.md file into categorized items */
function parseTodoFile(filePath: string): { pending: TodoItem[]; ongoing: TodoItem[]; done: TodoItem[] } {
  const pending: TodoItem[] = []
  const ongoing: TodoItem[] = []
  const done: TodoItem[] = []

  let section: 'pending' | 'in_progress' | 'done' = 'pending'

  try {
    const text = readFileSync(filePath, 'utf-8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      // Section headers shift the context
      if (/^#{1,4}\s/.test(trimmed)) {
        if (IN_PROGRESS_HEADERS.test(trimmed)) section = 'in_progress'
        else if (DONE_HEADERS.test(trimmed)) section = 'done'
        else section = 'pending'
        continue
      }
      // Checked: done
      const doneMatch = trimmed.match(/^-\s+\[x\]\s+(.+)/i)
      if (doneMatch) { done.push({ title: doneMatch[1].trim(), source_file: filePath, status: 'done' }); continue }
      // Unchecked: use section context
      const pendingMatch = trimmed.match(/^-\s+\[ \]\s+(.+)/)
      if (pendingMatch) {
        const item: TodoItem = { title: pendingMatch[1].trim(), source_file: filePath, status: section === 'in_progress' ? 'in_progress' : 'inbox' }
        if (section === 'in_progress') ongoing.push(item)
        else pending.push(item)
      }
    }
  } catch { /* unreadable file */ }

  return { pending, ongoing, done }
}

/** Recursively find todo.md files up to depth 4 */
function findTodoFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return []
  const found: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isFile() && /^todo\.md$/i.test(entry.name)) {
        found.push(full)
      } else if (entry.isDirectory()) {
        found.push(...findTodoFiles(full, depth + 1))
      }
    }
  } catch { /* permission error */ }
  return found
}

/** GET /api/tasks/todo-sync?path=<dir> — scan folder for todo.md files */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const dir = searchParams.get('path')
  if (!dir) return NextResponse.json({ error: 'path is required' }, { status: 400 })

  try {
    statSync(dir)
  } catch {
    return NextResponse.json({ error: 'Directory not found or not accessible' }, { status: 404 })
  }

  try {
    const files = findTodoFiles(dir)
    const result: ParsedFile[] = files.map(fp => ({
      path: fp,
      ...parseTodoFile(fp),
    }))

    return NextResponse.json({
      files: result,
      totals: {
        pending: result.reduce((s, f) => s + f.pending.length, 0),
        ongoing: result.reduce((s, f) => s + f.ongoing.length, 0),
        done: result.reduce((s, f) => s + f.done.length, 0),
      }
    })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/tasks/todo-sync error')
    return NextResponse.json({ error: 'Scan failed: ' + err.message }, { status: 500 })
  }
}

/** POST /api/tasks/todo-sync — bulk import selected items as tasks */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { items }: { items: TodoItem[] } = body
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    if (items.length > MAX_IMPORT_ITEMS) {
      return NextResponse.json({ error: `You can import up to ${MAX_IMPORT_ITEMS} items at once` }, { status: 400 })
    }

    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const user = getUserFromRequest(request)
    const actor = user?.username || 'system'

    const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks (title, status, created_by, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    let created = 0
    let skipped = 0

    db.transaction(() => {
      for (const item of items) {
        const title = item.title?.trim()
        if (!title) continue
        const status = item.status === 'done' ? 'done' : item.status === 'in_progress' ? 'in_progress' : 'inbox'
        const meta = JSON.stringify({ source: 'todo_sync', source_file: item.source_file })
        const res = insert.run(title, status, actor, now, now, meta)
        if (res.changes > 0) created++
        else skipped++
      }
    })()

    logAuditEvent({
      action: 'todo_sync_import',
      actor,
      detail: { created, skipped, total: items.length },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    })

    return NextResponse.json({ created, skipped })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/todo-sync error')
    return NextResponse.json({ error: 'Import failed: ' + err.message }, { status: 500 })
  }
}
