import { describe, expect, it } from 'vitest'
import { deriveSocialMetrics, normalizeSocialMetrics, socialMetricInputSchema, socialPostIdentitySchema, socialSnapshotFingerprint } from './social-metrics'

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

  it('supports cross-channel identity, measurement windows, and lossless platform-specific raw metrics', () => {
    const reddit = socialMetricInputSchema.parse({
      ...base,
      channel: 'reddit',
      post_id: 'reddit-post-1',
      measurement_window: '24h',
      raw_platform_metrics: {
        score: 412,
        upvote_ratio: 0.91,
        subreddit: 'SideProject',
        promoted: false,
      },
      metrics: {
        comments: 37,
        link_clicks: 18,
        website_visits: 14,
        conversion: 2,
      },
    })
    expect(reddit.measurement_window).toBe('24h')
    expect(reddit.raw_platform_metrics).toEqual({
      score: 412,
      upvote_ratio: 0.91,
      subreddit: 'SideProject',
      promoted: false,
    })
    expect(socialPostIdentitySchema.parse({
      channel: 'reddit',
      account_ref: 'productbaton',
      post_id: 'reddit-post-1',
      content_id: 'content-001',
      post_url: 'https://www.reddit.com/r/SideProject/comments/example',
    }).channel).toBe('reddit')
  })

  it('normalizes comparable rates but keeps platform-specific scores out of the common denominator', () => {
    const parsed = socialMetricInputSchema.parse({
      ...base,
      measurement_window: '72h',
      raw_platform_metrics: { score: 9999 },
      metrics: {
        impressions: 2000,
        likes: 100,
        comments: 20,
        shares: 30,
        reposts: 10,
        saves: 40,
        link_clicks: 50,
        website_unique_visitors: 25,
        conversion: 5,
        completion_rate: 0.4,
      },
    })
    expect(normalizeSocialMetrics(parsed)).toMatchObject({
      exposure: 2000,
      engagement_actions: 200,
      engagement_rate: 0.1,
      comment_rate: 0.01,
      share_rate: 0.02,
      save_rate: 0.02,
      click_rate: 0.025,
      visitor_to_conversion_rate: 0.2,
      completion_rate: 0.4,
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
