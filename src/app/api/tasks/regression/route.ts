import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

interface RegressionTaskRow {
  id: number
  created_at: number
  completed_at: number | null
  retry_count: number | null
  outcome: string | null
  error_message: string | null
}

interface WindowStats {
  label: 'baseline' | 'post'
  start: number
  end: number
  sample_size: number
  latency_seconds: {
    p50: number | null
    p95: number | null
    avg: number | null
  }
  interventions: {
    count: number
    rate: number
  }
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric)
  }

  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000)
  }

  return null
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((percentile / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, value) => acc + value, 0)
  return sum / values.length
}

function isTaskIntervened(row: RegressionTaskRow): boolean {
  const retryCount = Number(row.retry_count || 0)
  const outcome = String(row.outcome || '').toLowerCase()
  const hasErrorMessage = String(row.error_message || '').trim().length > 0
  return retryCount > 0 || hasErrorMessage || outcome === 'failed' || outcome === 'partial' || outcome === 'abandoned'
}

function buildWindowStats(
  label: 'baseline' | 'post',
  start: number,
  end: number,
  tasks: RegressionTaskRow[],
): WindowStats {
  const latencySamples: number[] = []
  let interventionCount = 0

  for (const task of tasks) {
    if (!task.completed_at) continue
    if (task.completed_at < start || task.completed_at >= end) continue

    if (task.completed_at >= task.created_at) {
      latencySamples.push(task.completed_at - task.created_at)
    }
    if (isTaskIntervened(task)) {
      interventionCount += 1
    }
  }

  const sampleSize = latencySamples.length
  return {
    label,
    start,
    end,
    sample_size: sampleSize,
    latency_seconds: {
      p50: percentileNearestRank(latencySamples, 50),
      p95: percentileNearestRank(latencySamples, 95),
      avg: average(latencySamples),
    },
    interventions: {
      count: interventionCount,
      rate: sampleSize > 0 ? interventionCount / sampleSize : 0,
    },
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)
    const { searchParams } = new URL(request.url)

    const betaStart = parseTimestamp(searchParams.get('beta_start') || searchParams.get('cutover'))
    if (!betaStart) {
      return NextResponse.json({ error: 'beta_start query parameter is required (unix seconds or ISO timestamp)' }, { status: 400 })
    }
    if (betaStart > now) {
      return NextResponse.json({ error: 'beta_start must not be in the future' }, { status: 400 })
    }

    const maxLookbackSeconds = 30 * 24 * 60 * 60
    const lookbackSecondsRaw = Number(searchParams.get('lookback_seconds') || 7 * 24 * 60 * 60)
    const lookbackSeconds = Math.min(maxLookbackSeconds, Math.max(60, Math.floor(Number.isFinite(lookbackSecondsRaw) ? lookbackSecondsRaw : 7 * 24 * 60 * 60)))

    const postStart = betaStart
    // Include tasks completed in the current second.
    const postEnd = now + 1
    const postDuration = Math.max(60, postEnd - postStart)
    const baselineDuration = Math.min(lookbackSeconds, postDuration)
    const baselineEnd = betaStart
    const baselineStart = Math.max(0, baselineEnd - baselineDuration)

    const db = getDatabase()
    const rows = db.prepare(`
      SELECT
        id,
        created_at,
        completed_at,
        retry_count,
        outcome,
        error_message
      FROM tasks
      WHERE workspace_id = ?
        AND status = 'done'
        AND completed_at IS NOT NULL
        AND completed_at >= ?
        AND completed_at < ?
    `).all(workspaceId, baselineStart, postEnd) as RegressionTaskRow[]

    const baseline = buildWindowStats('baseline', baselineStart, baselineEnd, rows)
    const post = buildWindowStats('post', postStart, postEnd, rows)

    const p95Delta = (post.latency_seconds.p95 !== null && baseline.latency_seconds.p95 !== null)
      ? post.latency_seconds.p95 - baseline.latency_seconds.p95
      : null
    const interventionRateDelta = post.interventions.rate - baseline.interventions.rate

    return NextResponse.json({
      metric_definitions: {
        p95_task_latency_seconds: '95th percentile of (completed_at - created_at) for done tasks in the window',
        intervention_rate: 'intervened_task_count / sample_size where intervened = retry_count>0 OR outcome in {failed,partial,abandoned} OR error_message not empty',
      },
      params: {
        beta_start: betaStart,
        lookback_seconds: lookbackSeconds,
      },
      windows: {
        baseline,
        post,
      },
      deltas: {
        p95_latency_seconds: p95Delta,
        intervention_rate: interventionRateDelta,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/regression error')
    return NextResponse.json({ error: 'Failed to compute regression metrics' }, { status: 500 })
  }
}
