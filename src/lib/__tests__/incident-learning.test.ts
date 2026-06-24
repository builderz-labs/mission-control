import { describe, it, expect } from 'vitest'
import {
  actualSeverityFromSignals,
  severityScale,
  scaleToSeverity,
  classifyAccuracy,
  confidenceFor,
  median,
  normaliseCategory,
  buildRuleCandidates,
  pickBestRule,
  type OutcomeRow,
} from '../incident-learning'

describe('severity scale', () => {
  it('maps severities to a 1-4 scale and back', () => {
    expect(severityScale('low')).toBe(1)
    expect(severityScale('critical')).toBe(4)
    expect(severityScale(null)).toBe(0)
    expect(scaleToSeverity(4)).toBe('critical')
    expect(scaleToSeverity(2)).toBe('medium')
    expect(scaleToSeverity(9)).toBe('critical') // clamps
  })
})

describe('actualSeverityFromSignals', () => {
  it('escalates a costly, guest-hurting incident to critical', () => {
    const r = actualSeverityFromSignals({ cost: 650, guestImpactScore: 9, guestMentions: 4, resolutionHours: 200 })
    expect(r.severity).toBe('critical')
  })
  it('keeps a cheap, no-guest-impact incident low', () => {
    const r = actualSeverityFromSignals({ cost: 40, guestImpactScore: 1, guestMentions: 0, resolutionHours: 3 })
    expect(r.severity).toBe('low')
  })
  it('treats a mid-cost item as medium/high', () => {
    expect(actualSeverityFromSignals({ cost: 200 }).severity).toBe('medium')
    expect(actualSeverityFromSignals({ cost: 200, guestImpactScore: 6 }).severity).toBe('high')
  })
})

describe('classifyAccuracy', () => {
  it('classifies under/over/accurate by signed delta', () => {
    expect(classifyAccuracy(0)).toBe('accurate')
    expect(classifyAccuracy(2)).toBe('under_predicted')
    expect(classifyAccuracy(-1)).toBe('over_predicted')
  })
})

describe('confidence + median', () => {
  it('confidence rises with hits and consistency', () => {
    const a = confidenceFor(3, 1)
    const b = confidenceFor(4, 1)
    expect(b).toBeGreaterThan(a)
    expect(confidenceFor(4, 0.5)).toBeLessThan(confidenceFor(4, 1))
    expect(confidenceFor(0, 1)).toBe(0)
  })
  it('median handles odd and even sets', () => {
    expect(median([60, 55, 65])).toBe(60)
    expect(median([50, 70])).toBe(60)
    expect(median([])).toBeNull()
  })
})

describe('normaliseCategory', () => {
  it('lowercases and slugifies', () => {
    expect(normaliseCategory('Water Leak')).toBe('water_leak')
    expect(normaliseCategory(null)).toBe('uncategorised')
  })
})

function outcome(p: Partial<OutcomeRow> & { incident_id: number; property_id: string; category: string }): OutcomeRow {
  return {
    actual_severity: 'critical',
    actual_impact_score: 9,
    severity_delta: 0,
    recurrence_days: null,
    ...p,
  }
}

describe('buildRuleCandidates', () => {
  it('learns a recurring critical property rule and auto-arms at 4 consistent hits', () => {
    const rows: OutcomeRow[] = [
      outcome({ incident_id: 1, property_id: 'PIMLICO', category: 'water', recurrence_days: 60 }),
      outcome({ incident_id: 2, property_id: 'PIMLICO', category: 'water', recurrence_days: 55 }),
      outcome({ incident_id: 3, property_id: 'PIMLICO', category: 'water', recurrence_days: 65 }),
      outcome({ incident_id: 4, property_id: 'PIMLICO', category: 'water', recurrence_days: 58 }),
    ]
    const cands = buildRuleCandidates(rows)
    const prop = cands.find((c) => c.pattern_key === 'water@PIMLICO')!
    expect(prop).toBeTruthy()
    expect(prop.predicted_severity).toBe('critical')
    expect(prop.status).toBe('armed')
    expect(prop.recurs_within_days).toBeGreaterThanOrEqual(55)
    expect(prop.recurs_within_days).toBeLessThanOrEqual(65)
    expect(prop.recurrence_rate).toBe(1)
  })

  it('keeps a 3-hit pattern in shadow (below arm threshold)', () => {
    const rows: OutcomeRow[] = [
      outcome({ incident_id: 1, property_id: 'HOXTON', category: 'cleaner', actual_severity: 'low', actual_impact_score: 1 }),
      outcome({ incident_id: 2, property_id: 'HOXTON', category: 'cleaner', actual_severity: 'low', actual_impact_score: 2 }),
      outcome({ incident_id: 3, property_id: 'HOXTON', category: 'cleaner', actual_severity: 'low', actual_impact_score: 1 }),
    ]
    const prop = buildRuleCandidates(rows).find((c) => c.pattern_key === 'cleaner@HOXTON')!
    expect(prop.predicted_severity).toBe('low')
    expect(prop.status).toBe('shadow')
  })

  it('drops a group below min hits', () => {
    const rows: OutcomeRow[] = [outcome({ incident_id: 1, property_id: 'KENSINGTON', category: 'electrical' })]
    expect(buildRuleCandidates(rows)).toHaveLength(0)
  })
})

describe('pickBestRule', () => {
  const rules = [
    { scope_type: 'category', property_id: null, category: 'water', confidence: 0.7, status: 'armed' },
    { scope_type: 'property_category', property_id: 'PIMLICO', category: 'water', confidence: 0.6, status: 'shadow' },
  ]
  it('prefers the property-specific rule over the category rule', () => {
    const best = pickBestRule(rules, 'PIMLICO', 'water')
    expect(best?.property_id).toBe('PIMLICO')
  })
  it('falls back to the category rule for other properties', () => {
    const best = pickBestRule(rules, 'SOHO', 'water')
    expect(best?.property_id).toBeNull()
  })
  it('ignores rejected rules', () => {
    const best = pickBestRule([{ ...rules[0], status: 'rejected' }], 'SOHO', 'water')
    expect(best).toBeNull()
  })
})
