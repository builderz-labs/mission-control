import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions } from '@/lib/sessions'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

// ── Types ──────────────────────────────────────────────────────────────────

interface GatewaySessionRaw {
  sessionId?: string
  key?: string
  agent?: string
  active?: boolean
  totalTokens?: number
  contextTokens?: number
  updatedAt?: number
  model?: string
  channel?: string
}

interface SessionSummary {
  id: string
  agent: string
  model: string
  tokens: number
  contextSize: number
  tokenUsagePct: number
  age: number        // ms since last activity
  ageLabel: string
  active: boolean
  channel: string
}

interface ModelPingResult {
  provider: string
  model: string
  status: 'up' | 'down' | 'degraded'
  latencyMs: number
  checkedAt: number
  error?: string
}

interface WaterfallRow {
  id: number
  name: string
  agent_id: number | null
  created_at: number
  steps: WaterfallStepRow[]
}

interface WaterfallStepRow {
  id: number
  waterfall_id: number
  step_order: number
  provider: string
  model: string
}

interface SessionLimitRow {
  id: number
  session_key: string
  max_tokens: number
  alert_threshold: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatAge(tsMs: number): string {
  if (!tsMs) return '-'
  const diff = Date.now() - tsMs
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

/**
 * Build a summary from live gateway sessions (in-memory store, no I/O).
 */
function buildSessionSummaries(): SessionSummary[] {
  try {
    const raw = getAllGatewaySessions() as GatewaySessionRaw[]
    return raw.map(s => {
      const tokens = s.totalTokens ?? 0
      const context = s.contextTokens ?? 35_000
      const pct = context > 0 ? Math.round((tokens / context) * 100) : 0
      const lastActivity = s.updatedAt ?? 0
      return {
        id: s.sessionId ?? `${s.agent}:${s.key}`,
        agent: s.agent ?? 'unknown',
        model: s.model ?? 'unknown',
        tokens,
        contextSize: context,
        tokenUsagePct: pct,
        age: Date.now() - lastActivity,
        ageLabel: formatAge(lastActivity),
        active: s.active ?? false,
        channel: s.channel ?? 'unknown',
      }
    })
  } catch (err) {
    logger.warn({ err }, 'session-dashboard: failed to read gateway sessions')
    return []
  }
}

/**
 * Pull the last model health-check results from SQLite (populated by /api/models health checker).
 * Returns empty array gracefully if the table doesn't exist yet.
 */
function getModelHealthResults(): ModelPingResult[] {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT mc.provider, mc.alias AS model, mh.status, mh.latency, mh.error, mh.checked_at
      FROM model_configs mc
      LEFT JOIN model_health_checks mh ON mh.model_id = mc.id
        AND mh.id = (
          SELECT id FROM model_health_checks
          WHERE model_id = mc.id
          ORDER BY checked_at DESC LIMIT 1
        )
      WHERE mc.enabled = 1
      ORDER BY mc.provider, mc.alias
    `).all() as Array<{
      provider: string
      model: string
      status: string | null
      latency: number | null
      error: string | null
      checked_at: number | null
    }>

    return rows.map(r => ({
      provider: r.provider,
      model: r.model,
      status: (r.status === 'healthy' ? 'up' : r.status === 'degraded' ? 'degraded' : 'down') as 'up' | 'down' | 'degraded',
      latencyMs: r.latency ?? 0,
      checkedAt: r.checked_at ? r.checked_at * 1000 : 0,
      error: r.error ?? undefined,
    }))
  } catch (err) {
    logger.warn({ err }, 'session-dashboard: failed to read model health results')
    return []
  }
}

/**
 * Read waterfalls and their steps from DB.
 */
function getWaterfalls(): WaterfallRow[] {
  try {
    const db = getDatabase()
    const waterfalls = db.prepare(
      `SELECT id, name, agent_id, created_at FROM model_waterfalls ORDER BY created_at DESC LIMIT 100`
    ).all() as Array<{ id: number; name: string; agent_id: number | null; created_at: number }>

    const steps = db.prepare(
      `SELECT id, waterfall_id, step_order, provider, model FROM waterfall_steps ORDER BY waterfall_id, step_order`
    ).all() as WaterfallStepRow[]

    const stepsByWaterfall = new Map<number, WaterfallStepRow[]>()
    for (const step of steps) {
      if (!stepsByWaterfall.has(step.waterfall_id)) stepsByWaterfall.set(step.waterfall_id, [])
      stepsByWaterfall.get(step.waterfall_id)!.push(step)
    }

    return waterfalls.map(w => ({
      ...w,
      steps: stepsByWaterfall.get(w.id) ?? [],
    }))
  } catch (err) {
    logger.warn({ err }, 'session-dashboard: failed to read waterfalls')
    return []
  }
}

/**
 * Read session limits from DB.
 */
function getSessionLimits(): SessionLimitRow[] {
  try {
    const db = getDatabase()
    return db.prepare(
      `SELECT id, session_key, max_tokens, alert_threshold FROM session_limits ORDER BY id`
    ).all() as SessionLimitRow[]
  } catch (err) {
    logger.warn({ err }, 'session-dashboard: failed to read session limits')
    return []
  }
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const sessions = buildSessionSummaries()
    const modelHealth = getModelHealthResults()
    const waterfalls = getWaterfalls()
    const sessionLimits = getSessionLimits()

    // Gateway health: if any session is active, the gateway is reachable
    const activeSessions = sessions.filter(s => s.active)
    const gatewayStatus = sessions.length > 0 ? 'connected' : 'unknown'

    // Compaction indicators: sessions using >80% of context window
    const compactionCandidates = sessions.filter(s => s.tokenUsagePct >= 80).map(s => s.id)

    return NextResponse.json({
      gateway: {
        status: gatewayStatus,
        activeSessionCount: activeSessions.length,
        totalSessionCount: sessions.length,
      },
      sessions,
      modelHealth,
      waterfalls,
      sessionLimits,
      compactionCandidates,
      fetchedAt: Date.now(),
    })
  } catch (error) {
    logger.error({ err: error }, 'session-dashboard GET error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST (Waterfall CRUD + Session Limit CRUD) ─────────────────────────────

const WATERFALL_NAME_RE = /^[\w\s-]{1,80}$/

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { action } = body
    const db = getDatabase()

    switch (action) {
      // ── Waterfall CRUD ──────────────────────────────────────────────────
      case 'create-waterfall': {
        const { name, agent_id, steps } = body
        if (!name || !WATERFALL_NAME_RE.test(name)) {
          return NextResponse.json({ error: 'Invalid waterfall name' }, { status: 400 })
        }
        if (!Array.isArray(steps)) {
          return NextResponse.json({ error: 'steps must be an array' }, { status: 400 })
        }
        const result = db.prepare(
          `INSERT INTO model_waterfalls (name, agent_id) VALUES (?, ?)`
        ).run(name.trim(), agent_id ?? null)
        const waterfallId = result.lastInsertRowid as number

        const insertStep = db.prepare(
          `INSERT INTO waterfall_steps (waterfall_id, step_order, provider, model) VALUES (?, ?, ?, ?)`
        )
        db.transaction(() => {
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            if (!step?.provider || !step?.model) continue
            insertStep.run(waterfallId, i, String(step.provider), String(step.model))
          }
        })()
        return NextResponse.json({ success: true, id: waterfallId })
      }

      case 'delete-waterfall': {
        const { id } = body
        if (!id || typeof id !== 'number') {
          return NextResponse.json({ error: 'Invalid waterfall id' }, { status: 400 })
        }
        db.prepare(`DELETE FROM model_waterfalls WHERE id = ?`).run(id)
        return NextResponse.json({ success: true })
      }

      // ── Session Limit CRUD ──────────────────────────────────────────────
      case 'set-session-limit': {
        const { session_key, max_tokens, alert_threshold } = body
        if (!session_key || typeof session_key !== 'string' || session_key.length > 200) {
          return NextResponse.json({ error: 'Invalid session_key' }, { status: 400 })
        }
        const maxTok = Number(max_tokens)
        const alertPct = Number(alert_threshold)
        if (!Number.isFinite(maxTok) || maxTok < 1000 || maxTok > 2_000_000) {
          return NextResponse.json({ error: 'max_tokens must be between 1000 and 2000000' }, { status: 400 })
        }
        if (!Number.isFinite(alertPct) || alertPct < 1 || alertPct > 100) {
          return NextResponse.json({ error: 'alert_threshold must be between 1 and 100' }, { status: 400 })
        }
        db.prepare(`
          INSERT INTO session_limits (session_key, max_tokens, alert_threshold, updated_at)
          VALUES (?, ?, ?, unixepoch())
          ON CONFLICT(session_key) DO UPDATE SET
            max_tokens = excluded.max_tokens,
            alert_threshold = excluded.alert_threshold,
            updated_at = unixepoch()
        `).run(session_key.trim(), maxTok, alertPct)
        return NextResponse.json({ success: true })
      }

      case 'delete-session-limit': {
        const { session_key } = body
        if (!session_key || typeof session_key !== 'string') {
          return NextResponse.json({ error: 'Invalid session_key' }, { status: 400 })
        }
        db.prepare(`DELETE FROM session_limits WHERE session_key = ?`).run(session_key)
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Valid: create-waterfall, delete-waterfall, set-session-limit, delete-session-limit' },
          { status: 400 }
        )
    }
  } catch (error: any) {
    logger.error({ err: error }, 'session-dashboard POST error')
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
