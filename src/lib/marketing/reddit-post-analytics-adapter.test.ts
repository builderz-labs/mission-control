import { describe, expect, it, vi } from 'vitest'
import { buildVerifiedSocialMetricInput, type SocialAnalyticsFetchRequest } from './social-analytics-adapter'
import { RedditPostAnalyticsAdapter } from './reddit-post-analytics-adapter'

const request: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'reddit',
    account_ref: 'productbaton',
    post_id: 'abc123',
    post_url: 'https://www.reddit.com/r/SideProject/comments/abc123/example/',
    content_id: 'content-r-1',
  },
  measurement_window: '24h',
  captured_at: 1_791_000_000,
  attribution: { utm_source: 'reddit', utm_content: 'content-r-1' },
}

describe('Reddit OAuth post analytics adapter', () => {
  it('keeps score/upvote ratio raw and maps comments only into common metrics', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.hostname).toBe('oauth.reddit.com')
      expect(url.pathname).toBe('/api/info')
      expect(url.searchParams.get('id')).toBe('t3_abc123')
      expect(init?.headers).toMatchObject({
        Authorization: 'bearer reddit-token',
        'User-Agent': 'windows:productbaton-control-tower:v0.1 (by /u/productbaton)',
      })
      return new Response(JSON.stringify({
        data: {
          children: [{
            kind: 't3',
            data: {
              name: 't3_abc123',
              id: 'abc123',
              author: 'productbaton',
              score: 412,
              upvote_ratio: 0.91,
              num_comments: 37,
              subreddit: 'SideProject',
              permalink: '/r/SideProject/comments/abc123/example/',
              created_utc: 1791000000,
            },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new RedditPostAnalyticsAdapter({
      accessToken: 'reddit-token',
      redditUsername: 'productbaton',
      userAgent: 'windows:productbaton-control-tower:v0.1 (by /u/productbaton)',
      fetchImpl,
    })
    const observation = await adapter.fetchMetrics(request)
    const snapshot = buildVerifiedSocialMetricInput(adapter, request, observation)

    expect(snapshot.metrics).toEqual({ comments: 37 })
    expect(snapshot.raw_platform_metrics).toMatchObject({
      score: 412,
      upvote_ratio: 0.91,
      num_comments: 37,
      subreddit: 'SideProject',
    })
    expect(snapshot.metrics).not.toHaveProperty('views')
    expect(snapshot.metrics).not.toHaveProperty('impressions')
  })

  it('verifies the post belongs to the configured Reddit account', async () => {
    const adapter = new RedditPostAnalyticsAdapter({
      accessToken: 'token',
      redditUsername: 'productbaton',
      userAgent: 'windows:productbaton-control-tower:v0.1 (by /u/productbaton)',
      fetchImpl: async () => new Response(JSON.stringify({
        data: { children: [{ kind: 't3', data: { name: 't3_abc123', author: 'someone_else' } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    })
    await expect(adapter.fetchMetrics(request)).rejects.toThrow('ownership verification failed')
  })

  it('rejects bad configuration, wrong channel, malformed ids, HTTP errors and missing posts', async () => {
    expect(() => new RedditPostAnalyticsAdapter({
      accessToken: ' ', redditUsername: 'a', userAgent: 'ua',
    })).toThrow('access token')
    expect(() => new RedditPostAnalyticsAdapter({
      accessToken: 'x', redditUsername: ' ', userAgent: 'ua',
    })).toThrow('username')
    expect(() => new RedditPostAnalyticsAdapter({
      accessToken: 'x', redditUsername: 'a', userAgent: ' ',
    })).toThrow('User-Agent')

    const fetchImpl = vi.fn()
    const adapter = new RedditPostAnalyticsAdapter({
      accessToken: 'x', redditUsername: 'a', userAgent: 'ua', fetchImpl,
    })
    await expect(adapter.fetchMetrics({
      ...request,
      identity: { ...request.identity, channel: 'x' },
    })).rejects.toThrow('only accepts Reddit')
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(adapter.fetchMetrics({
      ...request,
      identity: { ...request.identity, post_id: 'not valid!' },
    })).rejects.toThrow('post id')

    const httpFail = new RedditPostAnalyticsAdapter({
      accessToken: 'x', redditUsername: 'a', userAgent: 'ua',
      fetchImpl: async () => new Response('{}', { status: 429 }),
    })
    await expect(httpFail.fetchMetrics(request)).rejects.toThrow('HTTP 429')

    const missing = new RedditPostAnalyticsAdapter({
      accessToken: 'x', redditUsername: 'a', userAgent: 'ua',
      fetchImpl: async () => new Response(JSON.stringify({ data: { children: [] } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    await expect(missing.fetchMetrics(request)).rejects.toThrow('did not return the requested post')
  })
})
