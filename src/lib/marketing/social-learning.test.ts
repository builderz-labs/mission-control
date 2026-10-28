import { describe, expect, it } from 'vitest'
import { socialMetricInputSchema, normalizeSocialMetrics } from './social-metrics'
import { buildSocialLearningObservation } from './social-learning'

describe('social learning handoff', () => {
  it('joins content intelligence with measured performance without inventing a verdict', () => {
    const input = socialMetricInputSchema.parse({
      channel: 'tiktok',
      account_ref: 'productbaton',
      post_id: 'tt-1',
      post_url: 'https://www.tiktok.com/@productbaton/video/1',
      content_id: 'content-1',
      captured_at: 100,
      source_type: 'official_api',
      source_ref: 'fixture:tt-1',
      measurement_window: '24h',
      content_intelligence: {
        topic: 'app resale',
        audience: 'indie hackers',
        hook: 'What is your app worth?',
        format: 'short-video',
        cta: 'Scan your app',
        conversion_goal: 'listing-created',
      },
      metrics: {
        views: 10000,
        comments: 50,
        shares: 100,
        link_clicks: 200,
        website_unique_visitors: 150,
        conversion: 6,
      },
      attribution: { utm_source: 'tiktok', utm_content: 'content-1' },
    })
    const observation = buildSocialLearningObservation(input, normalizeSocialMetrics(input))
    expect(observation.content_intelligence).toMatchObject({
      hook: 'What is your app worth?',
      format: 'short-video',
      conversion_goal: 'listing-created',
    })
    expect(observation.normalized_metrics).toMatchObject({
      exposure: 10000,
      comment_rate: 0.005,
      share_rate: 0.01,
      visitor_to_conversion_rate: 0.04,
    })
    expect(observation.interpretation_policy).toBe('observation_only_no_winner_without_baseline')
    expect(observation).not.toHaveProperty('winner')
    expect(observation).not.toHaveProperty('verdict')
  })
})
