/**
 * GET /api/epl/health — Fleet health for the Mission Control dashboard.
 *
 * REAL DATA: reads /atlas-data/fleet_health.json, written every ~5 min by the
 * on-box exporter (hugo/scripts/mc_health_export.py → /opt/atlas/data/, the same
 * /atlas-data:ro mount the Properties tiles use). Surfaces disk, memory,
 * Playwright-leak, cron integrity, BOOM cookie, and agent liveness as one card.
 * Falls back to a clearly-marked mock if the export is missing.
 *
 * Mirrors src/app/api/epl/properties/route.ts (same load+mock+parts pattern).
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'

type Status = 'ok' | 'warn' | 'danger'

interface Check {
  key: string
  status: Status
  value: string
  detail: string
}

interface Health {
  as_of: string
  status: Status
  summary: string
  checks: Check[]
  host: {
    disk_pct: number
    disk_free_gb: number
    mem_avail_mb: number
    swap_used_mb: number
    orphan_browsers: number
    load1: string
  }
  real: boolean
}

const REAL_PATH = process.env.MC_HEALTH_JSON || '/atlas-data/fleet_health.json'

const MOCK: Health = {
  as_of: new Date().toISOString(),
  status: 'ok',
  summary: 'MOCK — real export not found',
  checks: [
    { key: 'disk', status: 'ok', value: '—', detail: 'mock' },
    { key: 'memory', status: 'ok', value: '—', detail: 'mock' },
    { key: 'playwright_leak', status: 'ok', value: '—', detail: 'mock' },
    { key: 'cron', status: 'ok', value: '—', detail: 'mock' },
    { key: 'boom_cookie', status: 'ok', value: '—', detail: 'mock' },
    { key: 'agents', status: 'ok', value: '—', detail: 'mock' },
  ],
  host: { disk_pct: 0, disk_free_gb: 0, mem_avail_mb: 0, swap_used_mb: 0, orphan_browsers: 0, load1: '0' },
  real: false,
}

function loadData(): Health {
  try {
    const raw = JSON.parse(readFileSync(REAL_PATH, 'utf8'))
    if (Array.isArray(raw.checks) && raw.status) {
      return { ...raw, real: true } as Health
    }
  } catch {
    // fall through to mock
  }
  return MOCK
}

export async function GET(req: NextRequest) {
  const data = loadData()
  const part = new URL(req.url).searchParams.get('part')

  if (part === 'summary') {
    return NextResponse.json({
      status: data.status,
      summary: data.summary,
      as_of: data.as_of,
      real: data.real,
      bad: data.checks.filter(c => c.status === 'danger').length,
      warn: data.checks.filter(c => c.status === 'warn').length,
    })
  }
  if (part === 'checks') {
    return NextResponse.json({ checks: data.checks })
  }
  if (part === 'host') {
    return NextResponse.json(data.host)
  }

  return NextResponse.json(data)
}
