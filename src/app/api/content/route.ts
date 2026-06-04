import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ATHENA Content System data API.
 * Reads the token-free JSON mirror that content-system/sync.mjs writes into the
 * ATHENA-git clone, so Mission Control can visualize all brands/channels/pipeline
 * without holding a Notion token. Source of truth stays in Notion.
 */
function resolveMirrorDir(): string | null {
  const candidates = [
    process.env.ATHENA_CONTENT_DIR,
    process.env.ATHENA_GIT_PATH ? join(process.env.ATHENA_GIT_PATH, 'content-system') : null,
    'C:/Users/ellio/Desktop/Athena (Asus)/ATHENA-git/content-system',
    join(process.cwd(), '..', 'ATHENA-git', 'content-system'),
    join(process.cwd(), '..', '..', 'ATHENA-git', 'content-system'),
  ].filter((p): p is string => !!p)
  for (const p of candidates) {
    try { if (existsSync(p)) return p } catch { /* ignore */ }
  }
  return null
}

function readJson<T>(dir: string, file: string, fallback: T): { data: T; mtime: string | null } {
  try {
    const p = join(dir, file)
    if (!existsSync(p)) return { data: fallback, mtime: null }
    const parsed = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as unknown
    return { data: parsed as T, mtime: statSync(p).mtime.toISOString() }
  } catch {
    return { data: fallback, mtime: null }
  }
}

type Row = Record<string, unknown>

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const dir = resolveMirrorDir()
  if (!dir) {
    return NextResponse.json({
      ok: false,
      error: 'ATHENA content mirror not found. Set ATHENA_GIT_PATH (or ATHENA_CONTENT_DIR) and run content-system/sync.mjs.',
      brands: [], channels: [], pipeline: { steps: [], gates: [], edges: [] }, automations: [], queue: [],
    })
  }

  const brands = readJson<{ brands?: Row[] }>(dir, 'brands.json', {})
  const channels = readJson<{ channels?: Row[] }>(dir, 'channels.json', {})
  const pipeline = readJson<Record<string, unknown>>(dir, 'pipeline.json', { steps: [], gates: [], edges: [] })
  const automations = readJson<{ automations?: Row[] }>(dir, 'automations.json', {})
  const queue = readJson<{ items?: Row[] }>(dir, 'content-queue.json', {})

  return NextResponse.json({
    ok: true,
    mirrorDir: dir,
    syncedAt: brands.mtime,
    brands: brands.data.brands ?? [],
    channels: channels.data.channels ?? [],
    pipeline: pipeline.data ?? { steps: [], gates: [], edges: [] },
    automations: automations.data.automations ?? [],
    queue: queue.data.items ?? [],
  })
}
