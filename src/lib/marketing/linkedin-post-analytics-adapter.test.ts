import { describe, expect, it, vi } from 'vitest'
import { buildVerifiedSocialMetricInput, type SocialAnalyticsFetchRequest } from './social-analytics-adapter'
import { LinkedInPostAnalyticsAdapter } from './linkedin-post-analytics-adapter'

const orgRequest: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'linkedin',
    account_ref: 'productbaton',
    post_id: 'urn:li:share:12345',
    content_id: 'content-li-1',
  },
  measurement_window: '24h',
  captured_at: 1_791_000_000,
  attribution: { utm_source: 'linkedin', utm_content: 'content-li-1' },
}

describe('LinkedIn analytics adapter', () => {
  it('maps organization share statistics in one request', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/rest/organizationalEntityShareStatistics')
      expect(url.searchParams.get('organizationalEntity')).toBe('urn:li:organization:777')
      expect(url.searchParams.get('shares')).toBe('List(urn:li:share:12345)')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer li-token',
        'Linkedin-Version': '202609',
        'X-Restli-Protocol-Version': '2.0.0',
      })
      return new Response(JSON.stringify({
        elements: [{
          organizationalEntity: 'urn:li:organization:777',
          share: 'urn:li:share:12345',
          totalShareStatistics: {
            uniqueImpressionsCount: 3300,
            clickCount: 140,
            likeCount: 90,
            commentCount: 14,
            shareCount: 11,
            impressionCount: 5100,
            engagement: 0.05,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new LinkedInPostAnalyticsAdapter({
      accessToken: 'li-token',
      mode: 'organization',
      organizationUrn: 'urn:li:organization:777',
      fetchImpl,
    })
    const observation = await adapter.fetchMetrics(orgRequest)
    const snapshot = buildVerifiedSocialMetricInput(adapter, orgRequest, observation)
    expect(snapshot.metrics).toMatchObject({
      impressions: 5100,
      reach: 3300,
      link_clicks: 140,
      likes: 90,
      comments: 14,
      shares: 11,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats an explicitly queried organization post omitted from a successful response as zero activity', async () => {
    const adapter = new LinkedInPostAnalyticsAdapter({
      accessToken: 'li-token',
      mode: 'organization',
      organizationUrn: 'urn:li:organization:777',
      fetchImpl: async () => new Response(JSON.stringify({ elements: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    })
    const observation = await adapter.fetchMetrics(orgRequest)
    expect(observation.metrics).toMatchObject({
      impressions: 0, reach: 0, link_clicks: 0, likes: 0, comments: 0, shares: 0,
    })
  })

  it('collects member post analytics using total aggregation and restricted member permission surface', async () => {
    const counts: Record<string, number> = {
      IMPRESSION: 8000,
      MEMBERS_REACHED: 6000,
      RESHARE: 18,
      REACTION: 240,
      COMMENT: 33,
      POST_SAVE: 41,
      LINK_CLICKS: 190,
      FOLLOWER_GAINED_FROM_CONTENT: 12,
      PROFILE_VIEW_FROM_CONTENT: 55,
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/rest/memberCreatorPostAnalytics')
      expect(url.searchParams.get('aggregation')).toBe('TOTAL')
      const metric = String(url.searchParams.get('queryType'))
      return new Response(JSON.stringify({
        elements: [{ count: counts[metric], metricType: metric }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const adapter = new LinkedInPostAnalyticsAdapter({ accessToken: 'li-token', mode: 'member', fetchImpl })
    const observation = await adapter.fetchMetrics(orgRequest)
    expect(observation.metrics).toMatchObject({
      impressions: 8000,
      reach: 6000,
      reposts: 18,
      likes: 240,
      comments: 33,
      saves: 41,
      link_clicks: 190,
      follows: 12,
      profile_visits: 55,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(9)
  })

  it('rejects bad credentials/config, wrong channel, invalid URNs and HTTP errors', async () => {
    expect(() => new LinkedInPostAnalyticsAdapter({ accessToken: ' ', mode: 'member' })).toThrow('access token')
    expect(() => new LinkedInPostAnalyticsAdapter({
      accessToken: 'token', mode: 'organization', organizationUrn: 'bad',
    })).toThrow('organization URN')

    const fetchImpl = vi.fn()
    const member = new LinkedInPostAnalyticsAdapter({ accessToken: 'token', mode: 'member', fetchImpl })
    await expect(member.fetchMetrics({
      ...orgRequest,
      identity: { ...orgRequest.identity, channel: 'x' },
    })).rejects.toThrow('only accepts LinkedIn')
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(member.fetchMetrics({
      ...orgRequest,
      identity: { ...orgRequest.identity, post_id: 'not-a-urn' },
    })).rejects.toThrow('share or ugcPost URN')

    const fail = new LinkedInPostAnalyticsAdapter({
      accessToken: 'token',
      mode: 'organization',
      organizationUrn: 'urn:li:organization:777',
      fetchImpl: async () => new Response('{}', { status: 403 }),
    })
    await expect(fail.fetchMetrics(orgRequest)).rejects.toThrow('HTTP 403')
  })
})
