/**
 * Roy's Board — Redis-backed kanban
 * GET    /api/wildform/board           → { tasks }
 * POST   /api/wildform/board           → create task → { task }
 * PUT    /api/wildform/board           → update task → { task }
 * DELETE /api/wildform/board?id=xxx    → delete task → { ok }
 *
 * Auth: session cookie (requireRole viewer) OR x-api-key header
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

// ---- types ----

export interface BoardTask {
  id: string
  title: string
  description?: string
  column: 'backlog' | 'desk' | 'done'
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: 'roy' | 'dave'
  createdAt: string
  updatedAt: string
  completedAt?: string
}

interface Board {
  tasks: BoardTask[]
  updatedAt: string
}

// ---- Redis ----

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const BOARD_KEY = 'mc:roy:board'

async function redisCmd(...args: unknown[]): Promise<unknown> {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json() as { result: unknown }
  return json.result
}

async function boardGet(): Promise<Board> {
  try {
    const raw = await redisCmd('GET', BOARD_KEY) as string | null
    if (!raw) return { tasks: [], updatedAt: new Date().toISOString() }
    return JSON.parse(raw) as Board
  } catch {
    return { tasks: [], updatedAt: new Date().toISOString() }
  }
}

async function boardSet(board: Board): Promise<void> {
  await redisCmd('SET', BOARD_KEY, JSON.stringify(board))
}

// ---- nanoid (tiny, no dep) ----

function nanoid(len = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// ---- auth helper ----

function checkAuth(request: NextRequest): boolean {
  // Accept x-api-key header
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && apiKey === process.env.MC_API_KEY) return true

  // Fallback to session cookie
  const auth = requireRole(request, 'viewer')
  if (!('error' in auth)) return true

  return false
}

// ---- handlers ----

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const board = await boardGet()
  return NextResponse.json({ tasks: board.tasks })
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { title, description, column = 'backlog', priority = 'medium', source = 'dave' } = body
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const now = new Date().toISOString()
  const task: BoardTask = {
    id: nanoid(),
    title: title.trim(),
    description: description?.trim() || undefined,
    column,
    priority,
    source,
    createdAt: now,
    updatedAt: now,
    ...(column === 'done' ? { completedAt: now } : {}),
  }

  const board = await boardGet()
  board.tasks.push(task)
  board.updatedAt = now
  await boardSet(board)

  return NextResponse.json({ task }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const board = await boardGet()
  const idx = board.tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const now = new Date().toISOString()
  const existing = board.tasks[idx]
  const updated: BoardTask = { ...existing, ...updates, id, updatedAt: now }

  // Auto-set completedAt when moving to done
  if (updates.column === 'done' && !updated.completedAt) {
    updated.completedAt = now
  }

  board.tasks[idx] = updated
  board.updatedAt = now
  await boardSet(board)

  return NextResponse.json({ task: updated })
}

export async function DELETE(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const board = await boardGet()
  const before = board.tasks.length
  board.tasks = board.tasks.filter(t => t.id !== id)
  if (board.tasks.length === before) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  board.updatedAt = new Date().toISOString()
  await boardSet(board)

  return NextResponse.json({ ok: true })
}
