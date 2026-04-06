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

interface EvalRunRow {
  eval_layer: string
  score: number
  passed: number
  detail: string | null
  created_at: number
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
      return NextResponse.json({ error: 'Missing required parameter: agent' }, { status: 400 })
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
      `).all(agent, workspaceId, weeks * 7) as EvalRunRow[]

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
    `).all(agent, workspaceId, agent, workspaceId) as EvalRunRow[]

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
