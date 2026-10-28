import { describe, expect, it, vi } from 'vitest'
import { buildVerifiedSocialMetricInput, type SocialAnalyticsFetchRequest } from './social-analytics-adapter'
import { XPostAnalyticsAdapter } from './x-post-analytics-adapter'

const request: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'x',
    account_ref: 'productbaton',
    post_id: '12345',
    post_url: 'https://x.com/productbaton/status/12345',
    content_id: 'content-x-1',
  },
  measurement_window: '24h',
  captured_at: 1_791_000_000,
  attribution: { utm_source: 'x', utm_content: 'content-x-1' },
}

describe('X API v2 analytics adapter', () => {
  it('maps public and owned-post metrics without inventing unavailable values', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/2/tweets/12345')
      expect(url.searchParams.get('tweet.fields')).toContain('non_public_metrics')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user-token' })
      return new Response(JSON.stringify({
        data: {
          id: '12345',
          public_metrics: {
            like_count: 120,
            reply_count: 11,
            retweet_count: 18,
            quote_count: 4,
            bookmark_count: 9,
          },
          non_public_metrics: {
            impression_count: 4200,
            url_link_clicks: 77,
            user_profile_clicks: 33,
          },
          organic_metrics: {
            impression_count: 4100,
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new XPostAnalyticsAdapter({ accessToken: 'user-token', fetchImpl })
    const observation = await adapter.fetchMetrics(request)
    const snapshot = buildVerifiedSocialMetricInput(adapter, request, observation)

    expect(snapshot.metrics).toMatchObject({
      impressions: 4200,
      likes: 120,
      comments: 11,
      reposts: 18,
      saves: 9,
      link_clicks: 77,
      profile_visits: 33,
    })
    expect(JSON.parse(String(snapshot.raw_platform_metrics?.public_metrics))).toMatchObject({ quote_count: 4 })
    expect(observation.cost.paid_usd).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps private-only metrics null when the API omits them', async () => {
    const adapter = new XPostAnalyticsAdapter({
      accessToken: 'user-token',
      fetchImpl: async () => new Response(JSON.stringify({
        data: {
          id: '12345',
          public_metrics: { like_count: 3, reply_count: 1, retweet_count: 2 },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    })
    const observation = await adapter.fetchMetrics(request)
    expect(observation.metrics).toMatchObject({
      impressions: null,
      likes: 3,
      comments: 1,
      reposts: 2,
      link_clicks: null,
      profile_visits: null,
    })
  })

  it('rejects empty credentials, wrong channel, HTTP/API errors and mismatched posts', async () => {
    expect(() => new XPostAnalyticsAdapter({ accessToken: ' ' })).toThrow('access token is required')

    const fetchImpl = vi.fn()
    const adapter = new XPostAnalyticsAdapter({ accessToken: 'token', fetchImpl })
    await expect(adapter.fetchMetrics({
      ...request,
      identity: { ...request.identity, channel: 'tiktok' },
    })).rejects.toThrow('only accepts X')
    expect(fetchImpl).not.toHaveBeenCalled()

    const httpFail = new XPostAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response('{}', { status: 403 }),
    })
    await expect(httpFail.fetchMetrics(request)).rejects.toThrow('HTTP 403')

    const apiFail = new XPostAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify({ errors: [{ title: 'Unauthorized' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    await expect(apiFail.fetchMetrics(request)).rejects.toThrow('Unauthorized')

    const mismatch = new XPostAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify({ data: { id: '999' } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    await expect(mismatch.fetchMetrics(request)).rejects.toThrow('did not return the requested owned post')
  })
})
