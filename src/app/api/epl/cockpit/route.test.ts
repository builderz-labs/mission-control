import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

// The route + reader read ATLAS_COCKPIT_PATH at call time, so we can point it
// at a tmp file (or a missing path) per-test and re-import fresh modules.

const ENV_KEY = 'ATLAS_COCKPIT_PATH'

async function loadRoute() {
  // Fresh module instances so any module-level reads pick up the env we set.
  const mod = await import('./route')
  return mod
}

function makeReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/epl/cockpit${qs}`)
}

describe('GET /api/epl/cockpit — graceful empty fallback', () => {
  let prev: string | undefined

  beforeEach(() => {
    prev = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = prev
  })

  it('returns 200 with an EMPTY payload when the export file is missing (never 500)', async () => {
    process.env[ENV_KEY] = path.join(os.tmpdir(), `mc-cockpit-does-not-exist-${Date.now()}.json`)
    const { GET } = await loadRoute()

    const res = await GET(makeReq())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.source).toBe('empty')
    expect(body.timeline).toEqual([])
    expect(body.agent_feed).toEqual([])
    expect(body.tools).toEqual([])
    expect(body.conversations).toEqual([])
    expect(typeof body.week_now).toBe('number')
    expect(typeof body.generated_at).toBe('string')
  })

  it('returns an EMPTY payload (not 500) when the export JSON is invalid', async () => {
    const tmp = path.join(os.tmpdir(), `mc-cockpit-invalid-${Date.now()}.json`)
    await fs.writeFile(tmp, '{ this is not json', 'utf-8')
    process.env[ENV_KEY] = tmp
    try {
      const { GET } = await loadRoute()
      const res = await GET(makeReq())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.source).toBe('empty')
      expect(body.conversations).toEqual([])
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })

  it('reads + coerces a live export, dropping malformed rows', async () => {
    const tmp = path.join(os.tmpdir(), `mc-cockpit-live-${Date.now()}.json`)
    await fs.writeFile(
      tmp,
      JSON.stringify({
        generated_at: '2026-06-23T10:00:00Z',
        week_now: 26,
        timeline: [
          { agent: 'iris', items: [{ title: 'facts/FAQ', status: 'shipped', start_week: 25, end_week: 26 }] },
          { items: [{ title: 'no-agent lane' }] }, // dropped: no agent
        ],
        agent_feed: [{ ts: '2026-06-23T09:00:00Z', from: 'james', to: 'aria', summary: 'confirm ADR', kind: 'handoff', cost_usd: 0.04 }],
        tools: [{ agent: 'james', connectors: [{ name: 'QuickBooks', status: 'connected' }] }],
        conversations: [{ id: 'disp-145', agent: 'james', cost_usd: 0.31, turns: 4, last_ts: '2026-06-23T09:30:00Z', title: 'rebuild June P&L' }],
      }),
      'utf-8',
    )
    process.env[ENV_KEY] = tmp
    try {
      const { GET } = await loadRoute()
      const res = await GET(makeReq())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.source).toBe('live')
      expect(body.week_now).toBe(26)
      expect(body.timeline).toHaveLength(1) // malformed lane dropped
      expect(body.timeline[0].agent).toBe('iris')
      expect(body.conversations[0].cost_usd).toBe(0.31)
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })

  it('?part=summary returns honest counts + the source flag, never 500', async () => {
    process.env[ENV_KEY] = path.join(os.tmpdir(), `mc-cockpit-missing-summary-${Date.now()}.json`)
    const { GET } = await loadRoute()
    const res = await GET(makeReq('?part=summary'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.source).toBe('empty')
    expect(body.conversation_count).toBe(0)
    expect(body.handoff_cost_usd).toBe(0)
  })
})
