import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { listSocialMetricSnapshots, recordSocialMetricSnapshot, socialChannelRollup } from './social-metrics-store'

beforeEach(() => {
  db = new Database(':memory:')
})
afterEach(() => db.close())

const sample = {
  channel: 'threads' as const,
  account_ref: 'productbaton',
  post_id: 'post-1',
  content_id: 'content-1',
  captured_at: 1_790_086_400,
  source_type: 'manual' as const,
  source_ref: 'manual-2026-10-05',
  metrics: {
    views: 1000,
    profile_visits: 100,
    link_clicks: 25,
    likes: 80,
    comments: 12,
    shares: 8,
    follows: 15,
    signup: 5,
    activation: 3,
  },
  attribution: {},
}

describe('social metric snapshot store', () => {
  it('stores snapshots idempotently and isolates workspaces', () => {
    const first = recordSocialMetricSnapshot(1, sample)
    const second = recordSocialMetricSnapshot(1, sample)
    expect(first.snapshot_id).toBe(second.snapshot_id)
    expect(listSocialMetricSnapshots(1)).toHaveLength(1)
    expect(listSocialMetricSnapshots(2)).toHaveLength(0)
  })

  it('rolls up only the latest cumulative snapshot for each post', () => {
    recordSocialMetricSnapshot(1, sample)
    recordSocialMetricSnapshot(1, {
      ...sample,
      captured_at: sample.captured_at + 86_400,
      source_ref: 'manual-2026-10-06',
      metrics: {
        ...sample.metrics,
        views: 1500,
        link_clicks: 40,
        signup: 8,
        activation: 4,
      },
    })
    recordSocialMetricSnapshot(1, {
      ...sample,
      captured_at: sample.captured_at + 172_800,
      source_type: 'first_party_analytics',
      source_ref: 'utm-web-analytics-2026-10-07',
      metrics: {
        website_visits: 32,
        website_unique_visitors: 30,
        signup: 9,
        activation: 5,
      },
    })
    const rollup = socialChannelRollup(1)[0]
    expect(rollup.channel).toBe('threads')
    expect(rollup.snapshots).toBe(3)
    expect(rollup.unique_posts).toBe(1)
    expect(rollup.views).toBe(1500)
    expect(rollup.link_clicks).toBe(40)
    expect(rollup.website_visits).toBe(32)
    expect(rollup.website_unique_visitors).toBe(30)
    expect(rollup.signup).toBe(9)
    expect(rollup.visitor_to_signup_rate).toBeCloseTo(0.3)
    expect(rollup.signup_conversion).toBeCloseTo(9 / 40)
    expect(rollup.activation_conversion).toBeCloseTo(5 / 9)
  })
})
