/**
 * GET /api/epl/schedule — Fleet Schedule (every recurring/scheduled job) for the
 * Mission Control dashboard.
 *
 * REAL DATA: reads /atlas-data/mc_schedule.json, written hourly by the on-box
 * exporter (hugo/scripts/mc_schedule_export.py → /opt/ops/ → /opt/atlas/data/,
 * the same /atlas-data:ro mount the Properties tiles + Fleet-Health card use).
 * Aggregates VPS /etc/cron.d/agent-*,fleet-* + user crontab + Mac crons (pushed
 * by the Mac heartbeat to /opt/atlas/data/mac_schedule.json). For each job it
 * carries cadence, next_run, and last_run + pass/fail.
 *
 * Falls back to a clearly-marked mock if the export is missing.
 * Mirrors src/app/api/epl/health/route.ts (same load+mock+parts pattern).
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'

type Status = 'ok' | 'warn' | 'danger' | 'stale' | 'unavailable'
type RunStatus = 'pass' | 'fail' | 'unknown'

interface Source {
  key: string
  status: Status
  detail: string
}

interface Job {
  host: 'vps' | 'mac'
  source: string
  agent: string
  name: string
  cron: string
  cadence: string
  command: string
  log: string | null
  next_run: string | null
  last_run: string | null
  last_status: RunStatus
  last_detail: string
}

interface Schedule {
  as_of: string
  status: Status
  sources: Source[]
  jobs: Job[]
  counts: { total: number; vps: number; mac: number; failing: number; unknown: number }
  real: boolean
}

const REAL_PATH = process.env.MC_SCHEDULE_JSON || '/atlas-data/mc_schedule.json'

const MOCK: Schedule = {
  as_of: new Date().toISOString(),
  status: 'unavailable',
  sources: [{ key: 'exporter', status: 'unavailable', detail: 'MOCK — real export not found' }],
  jobs: [],
  counts: { total: 0, vps: 0, mac: 0, failing: 0, unknown: 0 },
  real: false,
}

function loadData(): Schedule {
  try {
    const raw = JSON.parse(readFileSync(REAL_PATH, 'utf8'))
    if (Array.isArray(raw.jobs) && raw.status) {
      return { ...raw, real: true } as Schedule
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
      as_of: data.as_of,
      real: data.real,
      counts: data.counts,
    })
  }
  if (part === 'sources') {
    return NextResponse.json({ sources: data.sources })
  }
  if (part === 'jobs') {
    return NextResponse.json({ jobs: data.jobs })
  }

  return NextResponse.json(data)
}
