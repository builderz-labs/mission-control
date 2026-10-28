import { describe, expect, it, vi } from 'vitest'
import { buildVerifiedSocialMetricInput, type SocialAnalyticsFetchRequest } from './social-analytics-adapter'
import { InstagramMediaAnalyticsAdapter } from './instagram-media-analytics-adapter'

const request: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'instagram',
    account_ref: 'productbaton',
    post_id: 'ig-media-1',
    post_url: 'https://www.instagram.com/p/example/',
    content_id: 'content-ig-1',
  },
  measurement_window: '24h',
  captured_at: 1_791_000_000,
  attribution: { utm_source: 'instagram', utm_content: 'content-ig-1' },
}

describe('Instagram media insights adapter', () => {
  it('maps current views-centric media insights into the canonical contract', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v26.0/ig-media-1/insights')
      expect(url.searchParams.get('metric')).toContain('views')
      expect(url.searchParams.get('metric')).not.toContain('impressions')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer ig-token' })
      return new Response(JSON.stringify({
        data: [
          { name: 'views', values: [{ value: 8500 }] },
          { name: 'reach', values: [{ value: 6100 }] },
          { name: 'likes', values: [{ value: 520 }] },
          { name: 'comments', values: [{ value: 44 }] },
          { name: 'saved', values: [{ value: 91 }] },
          { name: 'shares', values: [{ value: 73 }] },
          { name: 'total_interactions', values: [{ value: 728 }] },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new InstagramMediaAnalyticsAdapter({ accessToken: 'ig-token', fetchImpl })
    const observation = await adapter.fetchMetrics(request)
    const snapshot = buildVerifiedSocialMetricInput(adapter, request, observation)

    expect(snapshot.metrics).toMatchObject({
      views: 8500,
      reach: 6100,
      likes: 520,
      comments: 44,
      saves: 91,
      shares: 73,
    })
    expect(snapshot.raw_platform_metrics?.total_interactions).toBe(728)
    expect(observation.cost.paid_usd).toBe(0)
  })

  it('supports total_value response shape and leaves missing metrics null', async () => {
    const adapter = new InstagramMediaAnalyticsAdapter({
      accessToken: 'ig-token',
      fetchImpl: async () => new Response(JSON.stringify({
        data: [
          { name: 'views', total_value: { value: 90 } },
          { name: 'reach', total_value: { value: 70 } },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    })
    const observation = await adapter.fetchMetrics(request)
    expect(observation.metrics).toMatchObject({
      views: 90,
      reach: 70,
      likes: null,
      comments: null,
      saves: null,
      shares: null,
    })
  })

  it('rejects empty credentials, wrong channel, HTTP/API errors and empty insight responses', async () => {
    expect(() => new InstagramMediaAnalyticsAdapter({ accessToken: ' ' })).toThrow('access token is required')

    const fetchImpl = vi.fn()
    const adapter = new InstagramMediaAnalyticsAdapter({ accessToken: 'token', fetchImpl })
    await expect(adapter.fetchMetrics({
      ...request,
      identity: { ...request.identity, channel: 'x' },
    })).rejects.toThrow('only accepts Instagram')
    expect(fetchImpl).not.toHaveBeenCalled()

    const httpFail = new InstagramMediaAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response('{}', { status: 403 }),
    })
    await expect(httpFail.fetchMetrics(request)).rejects.toThrow('HTTP 403')

    const apiFail = new InstagramMediaAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid token' } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    await expect(apiFail.fetchMetrics(request)).rejects.toThrow('190')

    const empty = new InstagramMediaAnalyticsAdapter({
      accessToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    await expect(empty.fetchMetrics(request)).rejects.toThrow('returned no metrics')
  })
})
