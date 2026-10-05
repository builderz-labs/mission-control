import { describe, expect, it, vi } from 'vitest'
import { buildVerifiedSocialMetricInput, type SocialAnalyticsFetchRequest } from './social-analytics-adapter'
import { TikTokDisplayAnalyticsAdapter } from './tiktok-display-analytics-adapter'

const request: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'tiktok',
    account_ref: 'productbaton',
    post_id: 'tt-123',
    post_url: 'https://www.tiktok.com/@productbaton/video/tt-123',
    content_id: 'content-tt-1',
  },
  measurement_window: '24h',
  captured_at: 1_791_000_000,
  attribution: { utm_source: 'tiktok', utm_content: 'content-tt-1' },
}

describe('TikTok Display API analytics adapter', () => {
  it('maps official v2 video counts into the canonical analytics contract', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
      expect(JSON.parse(String(init?.body))).toEqual({ filters: { video_ids: ['tt-123'] } })
      return new Response(JSON.stringify({
        data: {
          videos: [{
            id: 'tt-123',
            view_count: 12000,
            like_count: 800,
            comment_count: 60,
            share_count: 140,
          }],
        },
        error: { code: 'ok', message: '', log_id: 'fixture-log' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new TikTokDisplayAnalyticsAdapter({ accessToken: 'test-token', fetchImpl })
    const observation = await adapter.fetchMetrics(request)
    const snapshot = buildVerifiedSocialMetricInput(adapter, request, observation)

    expect(snapshot.metrics).toMatchObject({
      views: 12000,
      likes: 800,
      comments: 60,
      shares: 140,
    })
    expect(snapshot.raw_platform_metrics).toEqual({
      view_count: 12000,
      like_count: 800,
      comment_count: 60,
      share_count: 140,
    })
    expect(observation.cost.paid_usd).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never treats an API error or missing video as verified metrics', async () => {
    const apiError = new TikTokDisplayAnalyticsAdapter({
      accessToken: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({
        data: {},
        error: { code: 'scope_not_authorized', message: 'nope' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    })
    await expect(apiError.fetchMetrics(request)).rejects.toThrow('scope_not_authorized')

    const missing = new TikTokDisplayAnalyticsAdapter({
      accessToken: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({
        data: { videos: [] },
        error: { code: 'ok', message: '' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    })
    await expect(missing.fetchMetrics(request)).rejects.toThrow('did not return the requested owned video')
  })

  it('rejects empty credentials and non-TikTok identities without a network call', async () => {
    expect(() => new TikTokDisplayAnalyticsAdapter({ accessToken: ' ' })).toThrow('access token is required')

    const fetchImpl = vi.fn()
    const adapter = new TikTokDisplayAnalyticsAdapter({ accessToken: 'test-token', fetchImpl })
    await expect(adapter.fetchMetrics({
      ...request,
      identity: { ...request.identity, channel: 'x' },
    })).rejects.toThrow('only accepts TikTok')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
