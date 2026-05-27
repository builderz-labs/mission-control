import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMaintenanceSummary, maintenanceKpi, type MaintenanceSummary } from '../maintenance-summary'

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  vi.useFakeTimers()
  delete process.env.HUGO_STATS_URL
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.useRealTimers()
})

describe('getMaintenanceSummary', () => {
  it('falls back to mock when Hugo URL unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch
    const summary = await getMaintenanceSummary()
    expect(summary.hugo_status).toBe('offline')
    expect(summary.ok).toBe(true)
    expect(typeof summary.open_total).toBe('number')
    expect(summary.hugo_stats_url).toMatch(/\/api\/stats$/)
  })

  it('returns live shape when Hugo responds with agent:hugo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agent: 'hugo',
        open: 12,
        open_p0: 1,
        open_p1: 3,
        awaiting_parts_aged_gt7d: 2,
        resolved_this_week: 4,
      }),
    }) as unknown as typeof fetch
    const summary = await getMaintenanceSummary()
    expect(summary.hugo_status).toBe('live')
    expect(summary.open_total).toBe(12)
    expect(summary.open_p0).toBe(1)
    expect(summary.open_p1).toBe(3)
    expect(summary.awaiting_parts_aged_gt7d).toBe(2)
    expect(summary.resolved_this_week).toBe(4)
  })

  it('ignores responses with wrong agent shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent: 'not-hugo', open: 99 }),
    }) as unknown as typeof fetch
    const summary = await getMaintenanceSummary()
    expect(summary.hugo_status).toBe('offline')
  })

  it('treats missing numeric fields as 0 on a live response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent: 'hugo' }),
    }) as unknown as typeof fetch
    const summary = await getMaintenanceSummary()
    expect(summary.hugo_status).toBe('live')
    expect(summary.open_total).toBe(0)
    expect(summary.open_p0).toBe(0)
  })
})

describe('maintenanceKpi', () => {
  const live = (overrides: Partial<MaintenanceSummary> = {}): MaintenanceSummary => ({
    ok: true,
    open_total: 12,
    open_p0: 1,
    open_p1: 3,
    awaiting_parts_aged_gt7d: 1,
    resolved_this_week: 4,
    hugo_status: 'live',
    hugo_stats_url: 'http://localhost:8000/api/stats',
    ...overrides,
  })

  it('renders the offline label when Hugo is offline', () => {
    const kpi = maintenanceKpi(live({ hugo_status: 'offline' }))
    expect(kpi.value).toBe('unavailable')
    expect(kpi.delta).toBe('Hugo offline')
  })

  it('renders open_total with P0 + P1 breakdown when live', () => {
    const kpi = maintenanceKpi(live())
    expect(kpi.value).toBe('12')
    expect(kpi.delta).toBe('1 P0 · 3 P1')
  })

  it('omits a severity row when its count is zero', () => {
    const kpi = maintenanceKpi(live({ open_p0: 0, open_p1: 2 }))
    expect(kpi.delta).toBe('2 P1')
  })

  it('falls back to awaiting-parts when no P0/P1 open', () => {
    const kpi = maintenanceKpi(live({ open_p0: 0, open_p1: 0, awaiting_parts_aged_gt7d: 3 }))
    expect(kpi.delta).toBe('3 awaiting parts >7d')
  })

  it('falls back to resolved-this-week when nothing else to flag', () => {
    const kpi = maintenanceKpi(live({ open_p0: 0, open_p1: 0, awaiting_parts_aged_gt7d: 0, resolved_this_week: 7 }))
    expect(kpi.delta).toBe('7 resolved this wk')
  })

  it('always labels the card consistently', () => {
    expect(maintenanceKpi(live()).label).toBe('Open maintenance tickets')
    expect(maintenanceKpi(live({ hugo_status: 'offline' })).label).toBe('Open maintenance tickets')
  })
})
