import { getErrorMessage } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

interface HealthLogRow {
  id: number
  provider: string
  latency_ms: number | null
  status: string
  error: string | null
  checked_at: number
}

interface ProviderHealthSummary {
  provider: string
  avgLatency: number | null
  p95Latency: number | null
  successRate: number
  lastError: string | null
  lastChecked: number | null
  recentLogs: RecentLog[]
}

interface RecentLog {
  id: number
  latency_ms: number | null
  status: string
  error: string | null
  checked_at: number
}

interface RecordBody {
  provider: string
  latency_ms?: number
  status: string
  error?: string
}

/**
 * GET /api/providers/health
 * Returns aggregated health data per provider (last 50 rows each).
 * Admin only — drives the Health Monitor section of ProviderFailoverPanel.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()

  try {
    // Fetch last 50 rows per provider using a window-function approach
    const rows = db
      .prepare(
        `SELECT id, provider, latency_ms, status, error, checked_at
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY provider ORDER BY checked_at DESC) AS rn
           FROM provider_health_log
         ) ranked
         WHERE rn <= 50
         ORDER BY provider ASC, checked_at DESC`,
      )
      .all() as HealthLogRow[]

    const byProvider = groupByProvider(rows)
    const summaries = Object.entries(byProvider).map(([provider, logs]) =>
      buildSummary(provider, logs),
    )

    return NextResponse.json({ health: summaries })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to fetch health data: ${getErrorMessage(err)}` },
      { status: 500 },
    )
  }
}

/**
 * POST /api/providers/health
 * Records a single health check result.
 * Admin only — called by monitoring logic or manual triggers.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()

  let body: RecordBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.provider || typeof body.provider !== 'string' || !body.provider.trim()) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }

  const validStatuses = ['ok', 'error', 'timeout', 'degraded']
  if (!validStatuses.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${validStatuses.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO provider_health_log (provider, latency_ms, status, error)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        body.provider.trim().toLowerCase(),
        body.latency_ms ?? null,
        body.status,
        body.error ?? null,
      )

    return NextResponse.json({ ok: true, id: result.lastInsertRowid })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to record health check: ${getErrorMessage(err)}` },
      { status: 500 },
    )
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByProvider(rows: HealthLogRow[]): Record<string, HealthLogRow[]> {
  return rows.reduce<Record<string, HealthLogRow[]>>((acc, row) => {
    if (!acc[row.provider]) acc[row.provider] = []
    acc[row.provider].push(row)
    return acc
  }, {})
}

function buildSummary(provider: string, logs: HealthLogRow[]): ProviderHealthSummary {
  const successCount = logs.filter((l) => l.status === 'ok').length
  const successRate = logs.length > 0 ? (successCount / logs.length) * 100 : 0

  const latencies = logs
    .map((l) => l.latency_ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)

  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
      : null

  const p95Latency =
    latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1]
      : null

  const lastErrorLog = logs.find((l) => l.error)
  const recentLogs: RecentLog[] = logs.slice(0, 5).map((l) => ({
    id: l.id,
    latency_ms: l.latency_ms,
    status: l.status,
    error: l.error,
    checked_at: l.checked_at,
  }))

  return {
    provider,
    avgLatency,
    p95Latency,
    successRate: Math.round(successRate),
    lastError: lastErrorLog?.error ?? null,
    lastChecked: logs[0]?.checked_at ?? null,
    recentLogs,
  }
}
