import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  runOutputEvals,
  evalReasoningCoherence,
  evalToolReliability,
  runDriftCheck,
  getDriftTimeline,
  type EvalResult,
} from '@/lib/agent-evals'

function normalizeScore(score: unknown): number {
  const value = typeof score === 'number' ? score : Number(score)
  if (!Number.isFinite(value)) return 0
  const scaled = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const agent = searchParams.get('agent')
    const action = searchParams.get('action')
    const workspaceId = auth.user.workspace_id ?? 1

    if (!agent) {
      const db = getDatabase()
      const latestRows = db.prepare(`
        SELECT e.agent_name, e.eval_layer, e.score, e.passed, e.detail, e.created_at
        FROM eval_runs e
        INNER JOIN (
          SELECT agent_name, eval_layer, MAX(created_at) as max_created
          FROM eval_runs
          WHERE workspace_id = ?
          GROUP BY agent_name, eval_layer
        ) latest
          ON e.agent_name = latest.agent_name
         AND e.eval_layer = latest.eval_layer
         AND e.created_at = latest.max_created
        WHERE e.workspace_id = ?
        ORDER BY e.agent_name ASC, e.eval_layer ASC
      `).all(workspaceId, workspaceId) as Array<{
        agent_name: string
        eval_layer: string
        score: number | null
        passed: number | null
        detail: string | null
        created_at: number
      }>

      const byAgent = new Map<string, {
        agentId: number
        name: string
        scores: Array<{ layer: string; score: number; maxScore: number }>
        convergence: number
        driftDetected: boolean
        lastEvalAt: number
      }>()

      let nextAgentId = 1
      for (const row of latestRows) {
        const name = String(row.agent_name || '').trim()
        if (!name) continue
        const normalized = normalizeScore(row.score)
        const entry = byAgent.get(name) ?? {
          agentId: nextAgentId++,
          name,
          scores: [],
          convergence: 0,
          driftDetected: false,
          lastEvalAt: 0,
        }

        entry.scores.push({
          layer: row.eval_layer,
          score: normalized,
          maxScore: 100,
        })
        entry.lastEvalAt = Math.max(entry.lastEvalAt, row.created_at || 0)
        if (row.eval_layer === 'drift' && (!row.passed || /drifted/i.test(String(row.detail || '')))) {
          entry.driftDetected = true
        }
        byAgent.set(name, entry)
      }

      const agents = Array.from(byAgent.values()).map((entry) => {
        const total = entry.scores.reduce((sum, layer) => sum + layer.score, 0)
        const convergence = entry.scores.length > 0
          ? Math.round(total / entry.scores.length)
          : 0
        return {
          ...entry,
          convergence,
        }
      })

      const overallConvergence = agents.length > 0
        ? Math.round(agents.reduce((sum, current) => sum + current.convergence, 0) / agents.length)
        : 0

      const driftAlerts = agents
        .filter((entry) => entry.driftDetected)
        .map((entry) => `${entry.name}: drift detected in latest evals`)

      return NextResponse.json({
        agents,
        overallConvergence,
        driftAlerts,
      })
    }

    // History mode
    if (action === 'history') {
      const weeks = parseInt(searchParams.get('weeks') || '4', 10)
      const db = getDatabase()

      const history = db.prepare(`
        SELECT eval_layer, score, passed, detail, created_at
        FROM eval_runs
        WHERE agent_name = ? AND workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(agent, workspaceId, weeks * 7) as any[]

      const driftTimeline = getDriftTimeline(agent, weeks, workspaceId)

      return NextResponse.json({
        agent,
        history,
        driftTimeline,
      })
    }

    // Default: latest eval results per layer
    const db = getDatabase()
    const latestByLayer = db.prepare(`
      SELECT e.eval_layer, e.score, e.passed, e.detail, e.created_at
      FROM eval_runs e
      INNER JOIN (
        SELECT eval_layer, MAX(created_at) as max_created
        FROM eval_runs
        WHERE agent_name = ? AND workspace_id = ?
        GROUP BY eval_layer
      ) latest ON e.eval_layer = latest.eval_layer AND e.created_at = latest.max_created
      WHERE e.agent_name = ? AND e.workspace_id = ?
    `).all(agent, workspaceId, agent, workspaceId) as any[]

    const driftResults = runDriftCheck(agent, workspaceId)
    const hasDrift = driftResults.some(d => d.drifted)

    return NextResponse.json({
      agent,
      layers: latestByLayer,
      drift: {
        hasDrift,
        metrics: driftResults,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/evals error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'run') {
      const auth = requireRole(request, 'operator')
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

      const rateCheck = mutationLimiter(request)
      if (rateCheck) return rateCheck

      const { agent, layer } = body
      if (!agent) return NextResponse.json({ error: 'Missing: agent' }, { status: 400 })

      const workspaceId = auth.user.workspace_id ?? 1
      const db = getDatabase()
      const results: EvalResult[] = []

      const layers = layer ? [layer] : ['output', 'trace', 'component', 'drift']

      for (const l of layers) {
        let evalResults: EvalResult[] = []
        switch (l) {
          case 'output':
            evalResults = runOutputEvals(agent, 168, workspaceId)
            break
          case 'trace':
            evalResults = [evalReasoningCoherence(agent, 24, workspaceId)]
            break
          case 'component':
            evalResults = [evalToolReliability(agent, 24, workspaceId)]
            break
          case 'drift': {
            const driftResults = runDriftCheck(agent, workspaceId)
            const driftScore = driftResults.filter(d => !d.drifted).length / Math.max(driftResults.length, 1)
            evalResults = [{
              layer: 'drift',
              score: Math.round(driftScore * 100) / 100,
              passed: !driftResults.some(d => d.drifted),
              detail: driftResults.map(d => `${d.metric}: ${d.drifted ? 'DRIFTED' : 'stable'} (delta=${d.delta})`).join('; '),
            }]
            break
          }
        }

        for (const r of evalResults) {
          db.prepare(`
            INSERT INTO eval_runs (agent_name, eval_layer, score, passed, detail, workspace_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(agent, r.layer, r.score, r.passed ? 1 : 0, r.detail, workspaceId)
          results.push(r)
        }
      }

      return NextResponse.json({ agent, results })
    }

    if (action === 'golden-set') {
      const auth = requireRole(request, 'admin')
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

      const rateCheck = mutationLimiter(request)
      if (rateCheck) return rateCheck

      const { name, entries } = body
      if (!name) return NextResponse.json({ error: 'Missing: name' }, { status: 400 })

      const workspaceId = auth.user.workspace_id ?? 1
      const db = getDatabase()

      db.prepare(`
        INSERT INTO eval_golden_sets (name, entries, created_by, workspace_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name, workspace_id)
        DO UPDATE SET entries = excluded.entries, updated_at = unixepoch()
      `).run(name, JSON.stringify(entries || []), auth.user.username, workspaceId)

      return NextResponse.json({ success: true, name })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/evals error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
