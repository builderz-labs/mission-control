import { describe, expect, it } from 'vitest'
import { deriveSocialMetrics, socialMetricInputSchema, socialSnapshotFingerprint } from './social-metrics'

const base = {
  channel: 'instagram' as const,
  account_ref: 'productbaton',
  post_id: 'p1',
  content_id: 'content-001',
  campaign_id: 'initial100',
  published_at: 1_790_000_000,
  captured_at: 1_790_086_400,
  source_type: 'manual' as const,
  source_ref: 'owner-insights-export-2026-10-05',
  metrics: {
    impressions: 1000,
    views: 900,
    reach: 800,
    profile_visits: 80,
    link_clicks: 40,
    website_visits: 32,
    website_unique_visitors: 30,
    likes: 120,
    comments: 10,
    shares: 20,
    reposts: 5,
    saves: 15,
    follows: 16,
    follower_delta: 15,
    watch_time_seconds: 5400,
    average_watch_time_seconds: 6,
    completion_rate: 0.35,
    signup: 10,
    activation: 5,
    conversion: 2,
    spend_usd: 0,
  },
  attribution: {
    utm_source: 'instagram',
    utm_medium: 'organic-social',
    utm_campaign: 'initial100',
    utm_content: 'content-001',
  },
}

describe('social metrics normalization', () => {
  it('derives comparable rates without inventing unavailable values', () => {
    const parsed = socialMetricInputSchema.parse(base)
    const derived = deriveSocialMetrics(parsed)
    expect(derived.ctr).toBeCloseTo(0.04)
    expect(derived.click_to_visit_rate).toBeCloseTo(0.8)
    expect(derived.visitor_to_signup_rate).toBeCloseTo(10 / 30)
    expect(derived.follow_conversion).toBeCloseTo(0.2)
    expect(derived.signup_conversion).toBeCloseTo(0.25)
    expect(derived.activation_conversion).toBeCloseTo(0.5)
    expect(derived.cpa_usd).toBe(0)

    const sparse = socialMetricInputSchema.parse({
      ...base,
      post_id: 'p2',
      metrics: { views: 100 },
    })
    expect(deriveSocialMetrics(sparse)).toMatchObject({
      engagement_rate: null,
      ctr: null,
      click_to_visit_rate: null,
      visitor_to_signup_rate: null,
      follow_conversion: null,
      signup_conversion: null,
      activation_conversion: null,
      cpa_usd: null,
    })
  })

  it('creates an idempotency fingerprint from the normalized snapshot', () => {
    const a = socialSnapshotFingerprint(base)
    const b = socialSnapshotFingerprint({ ...base })
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('rejects invalid completion rate instead of coercing it', () => {
    expect(() => socialMetricInputSchema.parse({
      ...base,
      metrics: { ...base.metrics, completion_rate: 1.2 },
    })).toThrow()
  })
})
