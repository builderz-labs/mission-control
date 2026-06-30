import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  normaliseActionType,
  directionFor,
  defaultMinDelta,
  computeImprovement,
  classifyVerdict,
  confidenceFor,
  buildActionStats,
  recordAction,
  reportActionOutcome,
  measureDueActions,
  rebuildActionStats,
  getActionLedger,
  registerMetricResolver,
  type OutcomeStatRow,
} from '../action-outcomes'

const DAY = 86400

// ============================================================================
//  Pure helpers
// ============================================================================

describe('normaliseActionType', () => {
  it('lowercases and underscores', () => {
    expect(normaliseActionType('Extension Offer')).toBe('extension_offer')
    expect(normaliseActionType('Price-Drop!')).toBe('price_drop')
    expect(normaliseActionType(null)).toBe('unspecified')
  })
})

describe('directionFor / defaultMinDelta', () => {
  it('uses explicit direction when valid', () => {
    expect(directionFor('adr', 'lower_is_better')).toBe('lower_is_better')
  })
  it('falls back to the known-metric direction', () => {
    expect(directionFor('arrears_gbp')).toBe('lower_is_better')
    expect(directionFor('occupancy_14d')).toBe('higher_is_better')
  })
  it('defaults unknown metrics to higher_is_better', () => {
    expect(directionFor('something_new')).toBe('higher_is_better')
  })
  it('gives boolean metrics a 0.5 min_delta', () => {
    expect(defaultMinDelta('booking_extended')).toBe(0.5)
    expect(defaultMinDelta('adr')).toBe(0)
  })
})

describe('computeImprovement', () => {
  it('signs improvement toward the goal for higher_is_better', () => {
    expect(computeImprovement(70, 85, 'higher_is_better')).toBe(15)
    expect(computeImprovement(70, 60, 'higher_is_better')).toBe(-10)
  })
  it('flips the sign for lower_is_better', () => {
    expect(computeImprovement(10, 4, 'lower_is_better')).toBe(6) // arrears down = good
    expect(computeImprovement(10, 14, 'lower_is_better')).toBe(-4)
  })
  it('returns null when a value is missing', () => {
    expect(computeImprovement(null, 5, 'higher_is_better')).toBeNull()
    expect(computeImprovement(5, null, 'higher_is_better')).toBeNull()
  })
})

describe('classifyVerdict', () => {
  it('marks a real gain as success and a real loss as regression', () => {
    expect(classifyVerdict({ baseline: 70, result: 85, direction: 'higher_is_better' })).toBe('success')
    expect(classifyVerdict({ baseline: 70, result: 55, direction: 'higher_is_better' })).toBe('regression')
  })
  it('treats a sub-threshold move as no_change', () => {
    expect(classifyVerdict({ baseline: 70, result: 72, direction: 'higher_is_better', minDelta: 5 })).toBe('no_change')
  })
  it('is inconclusive without a result', () => {
    expect(classifyVerdict({ baseline: 70, result: null, direction: 'higher_is_better' })).toBe('inconclusive')
  })
  it('handles a boolean 0->1 flip as success at minDelta 0.5', () => {
    expect(classifyVerdict({ baseline: 0, result: 1, direction: 'higher_is_better', minDelta: 0.5 })).toBe('success')
    expect(classifyVerdict({ baseline: 0, result: 0, direction: 'higher_is_better', minDelta: 0.5 })).toBe('no_change')
  })
})

describe('confidenceFor', () => {
  it('is zero with no decisive evidence', () => {
    expect(confidenceFor(0, 1)).toBe(0)
  })
  it('grows with sample size and consistency', () => {
    const few = confidenceFor(3, 1)
    const many = confidenceFor(10, 1)
    expect(many).toBeGreaterThan(few)
  })
  it('penalises a coin-flip record even with samples', () => {
    expect(confidenceFor(10, 0.5)).toBeLessThan(confidenceFor(10, 0.9))
  })
})

describe('buildActionStats', () => {
  it('rolls up across agent_action, agent, and action_type scopes', () => {
    const rows: OutcomeStatRow[] = [
      { agent: 'victoria', action_type: 'extension_offer', verdict: 'success', improvement: 1, reversible: true },
      { agent: 'victoria', action_type: 'extension_offer', verdict: 'success', improvement: 1, reversible: true },
      { agent: 'victoria', action_type: 'extension_offer', verdict: 'regression', improvement: -1, reversible: true },
      { agent: 'aria', action_type: 'price_drop', verdict: 'success', improvement: 5, reversible: false },
    ]
    const stats = buildActionStats(rows)
    const vix = stats.find((s) => s.scope_key === 'victoria::extension_offer')!
    expect(vix.attempts).toBe(3)
    expect(vix.successes).toBe(2)
    expect(vix.regressions).toBe(1)
    expect(vix.success_rate).toBeCloseTo(0.6667, 3)
    expect(vix.reversible_rate).toBe(1)

    const ariaType = stats.find((s) => s.scope_key === 'type:price_drop')!
    expect(ariaType.attempts).toBe(1)
    expect(ariaType.reversible_rate).toBe(0)

    // agent_action scope sorts ahead of agent / action_type scopes
    expect(stats[0].scope_type).toBe('agent_action')
  })

  it('excludes inconclusive from the success-rate denominator', () => {
    const rows: OutcomeStatRow[] = [
      { agent: 'a', action_type: 't', verdict: 'success', improvement: 1, reversible: true },
      { agent: 'a', action_type: 't', verdict: 'inconclusive', improvement: null, reversible: true },
    ]
    const stats = buildActionStats(rows)
    const s = stats.find((x) => x.scope_key === 'a::t')!
    expect(s.attempts).toBe(2)
    expect(s.inconclusive).toBe(1)
    expect(s.success_rate).toBe(1) // 1 success / 1 decisive
  })
})

// ============================================================================
//  DB layer — full capture → measure → roll up cycle
// ============================================================================

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

describe('migration 057 applies', () => {
  it('creates the action tables', () => {
    const db = freshDb()
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((r) => r.name)
    expect(names).toContain('agent_actions')
    expect(names).toContain('action_outcomes')
    expect(names).toContain('agent_action_stats')
  })
})

describe('recordAction', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('captures an action with a derived horizon and is idempotent on action_key', () => {
    const now = 1_700_000_000
    const a = recordAction(db, {
      action_key: 'k1', agent: 'aria', action_type: 'price_drop', metric: 'occupancy_14d',
      target_type: 'property', target_id: 'PIMLICO', baseline: 70, horizon_days: 14,
    }, 1, now)
    expect(a.created).toBe(true)
    expect(a.measure_after).toBe(now + 14 * DAY)

    const again = recordAction(db, {
      action_key: 'k1', agent: 'aria', action_type: 'price_drop', metric: 'occupancy_14d', baseline: 99,
    }, 1, now)
    expect(again.created).toBe(false)
    expect(again.id).toBe(a.id)

    const count = (db.prepare(`SELECT COUNT(*) c FROM agent_actions`).get() as any).c
    expect(count).toBe(1)
  })

  it('defaults a boolean metric min_delta to 0.5', () => {
    recordAction(db, { action_key: 'b1', agent: 'victoria', action_type: 'extension_offer', metric: 'booking_extended', baseline: 0 })
    const row = db.prepare(`SELECT min_delta, metric_direction FROM agent_actions WHERE action_key='b1'`).get() as any
    expect(row.min_delta).toBe(0.5)
    expect(row.metric_direction).toBe('higher_is_better')
  })
})

describe('measureDueActions', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('does not measure an action still inside its horizon', () => {
    const now = 1_700_000_000
    recordAction(db, { action_key: 'k', agent: 'aria', action_type: 'price_drop', metric: 'occupancy_14d', baseline: 70, horizon_days: 14 }, 1, now)
    const stats = measureDueActions(db, 1, now + 1 * DAY)
    expect(stats.due).toBe(0)
    expect(stats.measured).toBe(0)
  })

  it('measures a reported outcome past the horizon as success', () => {
    const now = 1_700_000_000
    const a = recordAction(db, { action_key: 'k', agent: 'aria', action_type: 'price_drop', metric: 'occupancy_14d', baseline: 70, horizon_days: 14 }, 1, now)
    reportActionOutcome(db, { actionId: a.id }, 88, 'occupancy climbed', now + 2 * DAY)

    // reportActionOutcome already measured it; status should be 'measured'
    const row = db.prepare(`SELECT status FROM agent_actions WHERE id=?`).get(a.id) as any
    expect(row.status).toBe('measured')
    const outcome = db.prepare(`SELECT verdict, improvement FROM action_outcomes WHERE action_id=?`).get(a.id) as any
    expect(outcome.verdict).toBe('success')
    expect(outcome.improvement).toBe(18)
  })

  it('uses a registered resolver when no value was reported', () => {
    registerMetricResolver('test_resolver_metric', () => 42)
    const now = 1_700_000_000
    recordAction(db, { action_key: 'r', agent: 'leo', action_type: 'listing_refresh', metric: 'test_resolver_metric', baseline: 10, horizon_days: 7 }, 1, now)
    const stats = measureDueActions(db, 1, now + 8 * DAY)
    expect(stats.measured).toBe(1)
    expect(stats.success).toBe(1)
    const outcome = db.prepare(`SELECT result, resolved_by FROM action_outcomes`).get() as any
    expect(outcome.result).toBe(42)
    expect(outcome.resolved_by).toBe('resolver:test_resolver_metric')
  })

  it('leaves an unresolvable action pending until grace expires, then marks inconclusive', () => {
    const now = 1_700_000_000
    recordAction(db, { action_key: 'u', agent: 'larry', action_type: 'landlord_checkin', metric: 'landlord_renewed', baseline: 0, horizon_days: 30 }, 1, now)

    // Just past horizon, inside grace → still pending.
    let stats = measureDueActions(db, 1, now + 31 * DAY)
    expect(stats.measured).toBe(0)
    expect(stats.pending).toBe(1)

    // Past horizon + grace → inconclusive (no value ever arrived).
    stats = measureDueActions(db, 1, now + 30 * DAY + 10 * DAY)
    expect(stats.measured).toBe(1)
    expect(stats.inconclusive).toBe(1)
  })
})

describe('rebuildActionStats + getActionLedger', () => {
  it('produces a trust ledger from realised outcomes', () => {
    const db = freshDb()
    const now = 1_700_000_000
    // Three extension offers from Victoria: 2 convert, 1 doesn't.
    for (let i = 0; i < 3; i++) {
      const a = recordAction(db, {
        action_key: `ext${i}`, agent: 'victoria', action_type: 'extension_offer', metric: 'booking_extended',
        target_type: 'booking', target_id: `B${i}`, baseline: 0, horizon_days: 14,
      }, 1, now)
      reportActionOutcome(db, { actionId: a.id }, i < 2 ? 1 : 0, null, now + 15 * DAY)
    }
    const scopes = rebuildActionStats(db, 1, now + 16 * DAY)
    expect(scopes).toBeGreaterThanOrEqual(3) // agent_action + agent + action_type

    const ledger = getActionLedger(db, 1)
    expect(ledger.summary.measured).toBe(3)
    expect(ledger.summary.success).toBe(2)
    const vix = ledger.ledger.find((s: any) => s.scope_key === 'victoria::extension_offer')
    expect(vix.attempts).toBe(3)
    expect(vix.successes).toBe(2)
    expect(vix.success_rate).toBeCloseTo(0.6667, 3)
    expect(vix.confidence).toBeGreaterThan(0)
  })
})
