import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { recordExperience, recordLearningEvidence } from '@/lib/factories/learning-store'
import { socialMetricInputSchema } from '@/lib/marketing/social-metrics'
import { listSocialMetricSnapshots, recordSocialMetricSnapshot, socialChannelRollup } from '@/lib/marketing/social-metrics-store'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)))
  return NextResponse.json({
    snapshots: listSocialMetricSnapshots(ws.workspaceId, limit),
    rollups: socialChannelRollup(ws.workspaceId),
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
  const parsed = socialMetricInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid social metric snapshot', details: parsed.error.flatten() }, { status: 400 })
  }

  const snapshot = recordSocialMetricSnapshot(ws.workspaceId, parsed.data)
  const experienceId = `social-snapshot:${snapshot.snapshot_id}`
  const derived = JSON.parse(snapshot.derived_metrics || '{}') as Record<string, unknown>

  recordExperience({
    workspaceId: ws.workspaceId,
    experienceId,
    factoryInstanceId: `marketing:social:${snapshot.channel}`,
    stageId: 'M11',
    actionType: 'social_metric_snapshot',
    workerKind: 'deterministic',
    workerIdentity: snapshot.source_type,
    metrics: [{ ...parsed.data.metrics, derived }],
    outcome: 'observed',
    cost: { paid_usd: 0, source: snapshot.source_type },
    evidenceRefs: [`social-metric:${snapshot.snapshot_id}`],
    sourceRevision: snapshot.snapshot_id,
    observedAt: snapshot.captured_at,
  })

  recordLearningEvidence({
    workspaceId: ws.workspaceId,
    evidenceId: `social-metric:${snapshot.snapshot_id}`,
    evidenceType: 'real_metric',
    sourceType: 'experience_event',
    sourceRef: experienceId,
    result: 'informational',
    subjectKey: `marketing:social:${snapshot.channel}:performance`,
    payload: {
      channel: snapshot.channel,
      content_id: snapshot.content_id,
      post_id: snapshot.post_id,
      campaign_id: snapshot.campaign_id,
      metrics: parsed.data.metrics,
      derived,
      note: 'Raw social metric snapshot; no positive/negative judgement without an explicit comparable baseline.',
    },
    observedAt: snapshot.captured_at,
  })

  return NextResponse.json({ snapshot }, { status: 201 })
}
