import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { recordExperience } from '@/lib/factories/learning-store'
import { opportunitySourceRegistry } from '@/lib/revenue-opportunity/sources'
import { runMarketScanner } from '@/lib/revenue-opportunity/scanner'
import {
  listMarketSignals,
  listRevenueOpportunities,
  opportunityStoreSummary,
  promoteSignalToOpportunity,
} from '@/lib/revenue-opportunity/store'

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('scan'),
    query_count: z.number().int().min(1).max(12).optional(),
    per_query: z.number().int().min(1).max(10).optional(),
    sources: z.array(z.string().min(1)).max(5).optional(),
  }),
  z.object({
    action: z.literal('promote_signal'),
    signal_id: z.string().min(1).max(128),
  }),
])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 12)))
  return NextResponse.json({
    summary: opportunityStoreSummary(ws.workspaceId),
    signals: listMarketSignals(ws.workspaceId, limit),
    opportunities: listRevenueOpportunities(ws.workspaceId, limit),
    sources: opportunitySourceRegistry,
    policy: {
      raw_signal_is_not_opportunity: true,
      evidence_gate_before_build: true,
      paid_api_default_usd_per_day: 0,
      automatic_build: false,
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const body = await request.json().catch(() => null)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Revenue Factory action', details: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.action === 'promote_signal') {
    try {
      const opportunity = promoteSignalToOpportunity(ws.workspaceId, parsed.data.signal_id, auth.user.username)
      recordExperience({
        workspaceId: ws.workspaceId,
        factoryInstanceId: 'revenue-opportunity-factory',
        stageId: 'R02',
        actionType: 'market_signal_promoted_to_research',
        workerKind: 'human',
        workerIdentity: auth.user.username,
        inputs: [{ signal_id: parsed.data.signal_id }],
        outcome: 'research',
        cost: { paid_usd: 0, local_compute: true },
        evidenceRefs: [`market-signal:${parsed.data.signal_id}`],
        sourceRevision: opportunity.opportunity_id,
      })
      return NextResponse.json({ opportunity }, { status: 201 })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Promotion failed' }, { status: 400 })
    }
  }

  try {
    const result = await runMarketScanner(ws.workspaceId, {
      queryCount: parsed.data.query_count,
      perQuery: parsed.data.per_query,
      sources: parsed.data.sources,
    })
    const run = result.run as Record<string, unknown>
    const runId = String(run.run_id || 'unknown')
    recordExperience({
      workspaceId: ws.workspaceId,
      experienceId: 'market-scan:' + runId,
      factoryInstanceId: 'revenue-opportunity-factory',
      stageId: 'R00',
      actionType: 'market_scan',
      workerKind: 'deterministic',
      workerIdentity: 'public-source-scanner',
      inputs: [{ queries: result.queries.map((q) => q.id), sources: result.sources }],
      metrics: [{
        fetched_count: result.fetched_count,
        inserted_count: result.inserted_count,
        error_count: result.errors.length,
      }],
      outcome: result.errors.length === 0 ? 'success' : result.inserted_count > 0 ? 'mixed' : 'failure',
      cost: { paid_usd: 0, source: 'public_free_apis' },
      evidenceRefs: ['scanner-run:' + runId],
      sourceRevision: runId,
    })
    return NextResponse.json({
      scan: result,
      summary: opportunityStoreSummary(ws.workspaceId),
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Market scan failed' }, { status: 500 })
  }
}
