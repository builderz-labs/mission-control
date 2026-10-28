import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { listSocialMetricHistory, listSocialMetricSnapshots, recordSocialMetricSnapshot, socialChannelRollup } from './social-metrics-store'

beforeEach(() => {
  db = new Database(':memory:')
})
afterEach(() => db.close())

const sample = {
  channel: 'threads' as const,
  account_ref: 'productbaton',
  post_id: 'post-1',
  post_url: 'https://example.com/post/1',
  content_id: 'content-1',
  captured_at: 1_790_086_400,
  source_type: 'manual' as const,
  source_ref: 'manual-2026-10-05',
  measurement_window: '24h' as const,
  raw_platform_metrics: { native_view_count: 1000, source_label: 'manual-export' },
  content_intelligence: { topic: 'app resale', audience: 'indie hackers', hook: 'What is your app worth?', format: 'short-video', cta: 'Scan your app' },
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

  it('persists measurement metadata and preserves append-only post history', () => {
    const first = recordSocialMetricSnapshot(1, { ...sample, measurement_window: '1h', captured_at: 100 })
    const second = recordSocialMetricSnapshot(1, {
      ...sample,
      measurement_window: '6h',
      captured_at: 200,
      source_ref: 'manual-6h',
      raw_platform_metrics: { native_view_count: 1400, source_label: 'manual-export' },
      metrics: { ...sample.metrics, views: 1400 },
    })

    const history = listSocialMetricHistory(1, { channel: 'threads', postId: sample.post_id })
    expect(history.map((row) => row.snapshot_id)).toEqual([first.snapshot_id, second.snapshot_id])
    expect(history.map((row) => row.measurement_window)).toEqual(['1h', '6h'])
    expect(history[0]?.post_url).toBe(sample.post_url)
    expect(JSON.parse(history[0]?.raw_platform_metrics || '{}')).toEqual(sample.raw_platform_metrics)
    expect(JSON.parse(history[0]?.content_intelligence || '{}')).toEqual(sample.content_intelligence)
    expect(JSON.parse(history[0]?.metrics || '{}').views).toBe(1000)
    expect(JSON.parse(history[1]?.metrics || '{}').views).toBe(1400)
  })

  it('upgrades a legacy snapshot table without deleting historical rows', () => {
    db.exec(`
      CREATE TABLE social_metric_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        snapshot_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        post_id TEXT NOT NULL,
        content_id TEXT NOT NULL,
        campaign_id TEXT,
        published_at INTEGER,
        captured_at INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        creative_variant TEXT,
        hook_variant TEXT,
        cta_variant TEXT,
        metrics TEXT NOT NULL DEFAULT '{}',
        derived_metrics TEXT NOT NULL DEFAULT '{}',
        attribution TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(workspace_id, snapshot_id)
      );
      INSERT INTO social_metric_snapshots (
        workspace_id, snapshot_id, channel, account_ref, post_id, content_id,
        captured_at, source_type, source_ref, metrics, derived_metrics, attribution
      ) VALUES (1, 'legacy-1', 'x', 'acct', 'post-old', 'content-old', 10, 'manual', 'legacy', '{}', '{}', '{}');
    `)
    const inserted = recordSocialMetricSnapshot(1, { ...sample, post_id: 'post-new', captured_at: 20 })
    expect(inserted.measurement_window).toBe('24h')
    expect(listSocialMetricSnapshots(1).map((row) => row.snapshot_id)).toContain('legacy-1')
    const legacy = listSocialMetricHistory(1, { postId: 'post-old' })[0]
    expect(legacy?.snapshot_id).toBe('legacy-1')
    expect(legacy?.raw_platform_metrics).toBe('{}')
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
