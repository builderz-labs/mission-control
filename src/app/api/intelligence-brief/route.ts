import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { generateWeeklyBrief, type IntelligenceBrief } from '@/lib/intelligence-brief'
import { eventBus } from '@/lib/event-bus'

// ---------------------------------------------------------------------------
// 5-minute in-memory cache per workspace
// ---------------------------------------------------------------------------

interface CacheEntry {
  brief: IntelligenceBrief
  expiresAt: number
}

// Keyed by workspaceId so multi-tenant setups stay isolated
const cache = new Map<number, CacheEntry>()

const CACHE_TTL_MS = 5 * 60 * 1000

function getCached(workspaceId: number): IntelligenceBrief | null {
  const entry = cache.get(workspaceId)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.brief
}

function setCached(workspaceId: number, brief: IntelligenceBrief): void {
  cache.set(workspaceId, { brief, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ---------------------------------------------------------------------------
// GET — return brief (from cache or freshly generated)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const cached = getCached(workspaceId)
  if (cached) {
    return NextResponse.json({ brief: cached, fromCache: true })
  }

  try {
    const db = getDatabase()
    const brief = generateWeeklyBrief(workspaceId, db)
    setCached(workspaceId, brief)
    eventBus.broadcast('brief.generated', { workspaceId, weekOf: brief.weekOf })
    return NextResponse.json({ brief, fromCache: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate brief'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST — force regenerate (bypasses cache)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const db = getDatabase()
    const brief = generateWeeklyBrief(workspaceId, db)
    setCached(workspaceId, brief)
    eventBus.broadcast('brief.generated', { workspaceId, weekOf: brief.weekOf })
    return NextResponse.json({ brief, fromCache: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate brief'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
