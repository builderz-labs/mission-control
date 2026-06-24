import { describe, it, expect } from 'vitest'
import {
  weekStart,
  weekRange,
  previousWeekOf,
  slugifyRuleKey,
  confidenceForRule,
  experimentVerdict,
  armEligible,
  retireEligible,
  normaliseRecommendedRule,
  parseReflectionResponse,
  heuristicReflection,
  buildReflectionPrompt,
  KNOWN_METRICS,
  type WeekData,
} from '../atlas-reflection'

describe('week math', () => {
  it('snaps any day to its Monday (UTC)', () => {
    // 2026-06-24 is a Wednesday -> Monday is 2026-06-22
    expect(weekStart(Date.parse('2026-06-24T12:00:00Z'))).toBe('2026-06-22')
    // Monday stays put
    expect(weekStart(Date.parse('2026-06-22T00:00:00Z'))).toBe('2026-06-22')
    // Sunday belongs to the week that started the prior Monday
    expect(weekStart(Date.parse('2026-06-28T23:00:00Z'))).toBe('2026-06-22')
  })

  it('produces a 7-day range and prior week', () => {
    const { start, end } = weekRange('2026-06-22')
    expect(end - start).toBe(7 * 86400)
    expect(previousWeekOf('2026-06-22')).toBe('2026-06-15')
  })
})

describe('slugifyRuleKey', () => {
  it('makes a stable lowercase slug', () => {
    expect(slugifyRuleKey('Escalate maintenance >£500 to Larry!')).toBe('escalate_maintenance_500_to_larry')
    expect(slugifyRuleKey('   ')).toBe('rule')
  })
})

describe('confidenceForRule', () => {
  it('is monotonic in weeks-applied and success-rate', () => {
    expect(confidenceForRule(0, 1)).toBe(0)
    const a = confidenceForRule(3, 0.6)
    const b = confidenceForRule(6, 0.6)
    const c = confidenceForRule(6, 1)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c).toBeLessThanOrEqual(0.99)
  })
})

describe('experimentVerdict', () => {
  it('treats lower-is-better correctly', () => {
    expect(experimentVerdict(100, 80, 'lower_is_better')).toEqual({ impact: 20, verdict: 'improved' })
    expect(experimentVerdict(80, 100, 'lower_is_better')).toEqual({ impact: -20, verdict: 'worsened' })
    expect(experimentVerdict(100, 100, 'lower_is_better')).toEqual({ impact: 0, verdict: 'no_change' })
  })
  it('treats higher-is-better correctly', () => {
    expect(experimentVerdict(0.5, 0.7, 'higher_is_better').verdict).toBe('improved')
    expect(experimentVerdict(0.7, 0.5, 'higher_is_better').verdict).toBe('worsened')
  })
  it('is inconclusive when a value is missing', () => {
    expect(experimentVerdict(null, 5, 'lower_is_better')).toEqual({ impact: null, verdict: 'inconclusive' })
    expect(experimentVerdict(5, null, 'higher_is_better')).toEqual({ impact: null, verdict: 'inconclusive' })
  })
})

describe('gating', () => {
  it('arms only when applied + rate + confidence clear the bar', () => {
    expect(armEligible({ applied_count: 3, success_rate: 0.7, confidence: 0.72 })).toBe(true)
    expect(armEligible({ applied_count: 2, success_rate: 0.9, confidence: 0.9 })).toBe(false) // too few weeks
    expect(armEligible({ applied_count: 5, success_rate: 0.4, confidence: 0.9 })).toBe(false) // weak rate
  })
  it('retires only when applied enough and clearly failing', () => {
    expect(retireEligible({ applied_count: 4, success_rate: 0.25 })).toBe(true)
    expect(retireEligible({ applied_count: 4, success_rate: 0.5 })).toBe(false)
    expect(retireEligible({ applied_count: 2, success_rate: 0 })).toBe(false)
  })
})

describe('normaliseRecommendedRule', () => {
  it('accepts aliased keys and rejects junk', () => {
    const r = normaliseRecommendedRule({ name: 'Foo', when: 'x_happens', action: 'do y', metric: 'time_to_resolution' })
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Foo')
    expect(r!.trigger_event).toBe('x_happens')
    expect(r!.then_action).toBe('do y')
    expect(normaliseRecommendedRule({ title: 'only title' })).toBeNull()
    expect(normaliseRecommendedRule(null)).toBeNull()
  })
})

describe('parseReflectionResponse', () => {
  it('parses a JSON object embedded in prose', () => {
    const text = 'Here you go:\n{"reflection":"a good week","insights":["x"],"handoffs":{"worked":["a"],"broke":["b"]},"bottlenecks":["c"],"recommended_rules":[{"title":"T","trigger_event":"e","then_action":"a","metric":"escalation_volume"}]}\nthanks'
    const p = parseReflectionResponse(text)
    expect(p.reflection).toBe('a good week')
    expect(p.insights).toEqual(['x'])
    expect(p.handoffs.worked).toEqual(['a'])
    expect(p.bottlenecks).toEqual(['c'])
    expect(p.recommended_rules).toHaveLength(1)
  })
  it('falls back to prose when there is no JSON', () => {
    const p = parseReflectionResponse('just some thoughts')
    expect(p.reflection).toBe('just some thoughts')
    expect(p.recommended_rules).toEqual([])
  })
})

function emptyWeek(): WeekData {
  return {
    week_of: '2026-06-22',
    briefings: [],
    tasks: { completed: 10, created: 8, overdue: 5, stalled: 3, completion_rate: 0.55, blocked_rate: 0.44, by_agent: [] },
    handoffs: { total: 12, by_type: [{ type: 'task_auto_routed', count: 12 }] },
    escalations: { high_priority_tasks: 2, high_severity_incidents: 1 },
    incidents: { total: 3, by_severity: [{ severity: 'high', count: 1 }], resolved: 2, avg_resolution_hours: 90 },
    active_rules: [],
    prior_reflection: null,
  }
}

describe('heuristicReflection', () => {
  it('proposes rules from observed pain and only uses known metrics', () => {
    const p = heuristicReflection(emptyWeek())
    expect(p.reflection).toContain('2026-06-22')
    expect(p.recommended_rules.length).toBeGreaterThan(0)
    for (const r of p.recommended_rules) {
      expect(r.metric == null || r.metric in KNOWN_METRICS).toBe(true)
    }
  })
})

describe('buildReflectionPrompt', () => {
  it('lists the measurable metrics and asks for JSON', () => {
    const prompt = buildReflectionPrompt(emptyWeek())
    expect(prompt).toContain('time_to_resolution')
    expect(prompt).toContain('recommended_rules')
    expect(prompt).toContain('JSON')
  })
})
