import { describe, expect, it } from 'vitest'
import {
  buildVerifiedSocialMetricInput,
  supportsSocialChannel,
  type SocialAnalyticsAdapter,
  type SocialAnalyticsFetchRequest,
} from './social-analytics-adapter'

const request: SocialAnalyticsFetchRequest = {
  identity: {
    channel: 'x',
    account_ref: 'productbaton',
    post_id: 'x-1',
    post_url: 'https://x.com/productbaton/status/1',
    content_id: 'content-1',
    campaign_id: 'initial100',
    published_at: 1_790_000_000,
  },
  measurement_window: '24h',
  captured_at: 1_790_086_400,
  attribution: {
    utm_source: 'x',
    utm_medium: 'organic-social',
    utm_content: 'content-1',
  },
}

function fakeAdapter(): SocialAnalyticsAdapter {
  return {
    id: 'test-x-adapter',
    channels: ['x'],
    source_type: 'official_api',
    network_access: false,
    requires_credentials: false,
    async fetchMetrics() {
      return {
        source_type: 'official_api',
        source_ref: 'fixture:x-1',
        verification_state: 'verified',
        metrics: { impressions: 1000, link_clicks: 50, comments: 10 },
        raw_platform_metrics: { impression_count: 1000, fixture: true },
        cost: { paid_usd: 0, local_compute: true },
      }
    },
  }
}

describe('social analytics adapter contract', () => {
  it('builds a canonical snapshot only from verified adapter evidence', async () => {
    const adapter = fakeAdapter()
    const observation = await adapter.fetchMetrics(request)
    const snapshot = buildVerifiedSocialMetricInput(adapter, request, observation)
    expect(snapshot).toMatchObject({
      channel: 'x',
      post_id: 'x-1',
      post_url: 'https://x.com/productbaton/status/1',
      measurement_window: '24h',
      source_type: 'official_api',
      source_ref: 'fixture:x-1',
      metrics: { impressions: 1000, link_clicks: 50, comments: 10 },
      raw_platform_metrics: { impression_count: 1000, fixture: true },
    })
    expect(supportsSocialChannel(adapter, 'x')).toBe(true)
    expect(supportsSocialChannel(adapter, 'reddit')).toBe(false)
  })

  it('rejects unverified observations and source-type spoofing', async () => {
    const adapter = fakeAdapter()
    const observation = await adapter.fetchMetrics(request)
    expect(() => buildVerifiedSocialMetricInput(adapter, request, {
      ...observation,
      verification_state: 'unverified',
    })).toThrow('Unverified social analytics observations')

    expect(() => buildVerifiedSocialMetricInput(adapter, request, {
      ...observation,
      source_type: 'manual',
    })).toThrow('unexpected source type')
  })

  it('rejects a channel the adapter did not declare', async () => {
    const adapter = fakeAdapter()
    const observation = await adapter.fetchMetrics(request)
    expect(() => buildVerifiedSocialMetricInput(adapter, {
      ...request,
      identity: { ...request.identity, channel: 'tiktok' },
    }, observation)).toThrow('does not support channel')
  })
})
