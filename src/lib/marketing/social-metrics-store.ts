import { getDatabase } from '@/lib/db'
import { deriveSocialMetrics, socialMetricInputSchema, socialSnapshotFingerprint, type SocialMetricInput } from './social-metrics'

export interface SocialMetricSnapshotRow {
  id: number
  workspace_id: number
  snapshot_id: string
  channel: string
  account_ref: string
  post_id: string
  content_id: string
  campaign_id: string | null
  published_at: number | null
  captured_at: number
  source_type: string
  source_ref: string
  creative_variant: string | null
  hook_variant: string | null
  cta_variant: string | null
  metrics: string
  derived_metrics: string
  attribution: string
  created_at: number
}

function ensureSocialMetricTable() {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_metric_snapshots (
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
    CREATE INDEX IF NOT EXISTS idx_social_metric_channel_captured
      ON social_metric_snapshots(workspace_id, channel, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_metric_content_captured
      ON social_metric_snapshots(workspace_id, content_id, captured_at DESC);
  `)
  return db
}

export function recordSocialMetricSnapshot(workspaceId: number, raw: SocialMetricInput): SocialMetricSnapshotRow {
  const input = socialMetricInputSchema.parse(raw)
  const snapshotId = `social:${socialSnapshotFingerprint(input)}`
  const derived = deriveSocialMetrics(input)
  const db = ensureSocialMetricTable()

  db.prepare(`
    INSERT OR IGNORE INTO social_metric_snapshots (
      workspace_id, snapshot_id, channel, account_ref, post_id, content_id, campaign_id,
      published_at, captured_at, source_type, source_ref, creative_variant, hook_variant,
      cta_variant, metrics, derived_metrics, attribution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    snapshotId,
    input.channel,
    input.account_ref,
    input.post_id,
    input.content_id,
    input.campaign_id || null,
    input.published_at ?? null,
    input.captured_at,
    input.source_type,
    input.source_ref,
    input.creative_variant || null,
    input.hook_variant || null,
    input.cta_variant || null,
    JSON.stringify(input.metrics),
    JSON.stringify(derived),
    JSON.stringify(input.attribution || {}),
  )

  return db.prepare(`
    SELECT * FROM social_metric_snapshots WHERE workspace_id = ? AND snapshot_id = ?
  `).get(workspaceId, snapshotId) as SocialMetricSnapshotRow
}

export function listSocialMetricSnapshots(workspaceId: number, limit = 100): SocialMetricSnapshotRow[] {
  const db = ensureSocialMetricTable()
  return db.prepare(`
    SELECT * FROM social_metric_snapshots
    WHERE workspace_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, limit))) as SocialMetricSnapshotRow[]
}

export function socialChannelRollup(workspaceId: number) {
  const rows = listSocialMetricSnapshots(workspaceId, 500)
  const metricKeys = [
    'views', 'impressions', 'reach', 'profile_visits', 'link_clicks',
    'website_visits', 'website_unique_visitors',
    'likes', 'comments', 'shares', 'saves', 'follows', 'signup', 'activation', 'conversion',
  ] as const

  const snapshotCounts = new Map<string, number>()
  const latestByPost = new Map<string, {
    channel: string
    latest_captured_at: number
    metrics: Record<string, number>
  }>()

  // Rows are newest-first. Keep the newest observed value for EACH metric, not just
  // the newest whole row. This lets official social metrics and first-party web
  // analytics arrive as independent sparse snapshots without erasing one another.
  for (const row of rows) {
    snapshotCounts.set(row.channel, (snapshotCounts.get(row.channel) || 0) + 1)
    const key = `${row.channel}:${row.post_id}`
    const post = latestByPost.get(key) || {
      channel: row.channel,
      latest_captured_at: row.captured_at,
      metrics: {},
    }
    post.latest_captured_at = Math.max(post.latest_captured_at, row.captured_at)

    let metrics: Record<string, unknown> = {}
    try { metrics = JSON.parse(row.metrics || '{}') as Record<string, unknown> } catch { metrics = {} }
    for (const metric of metricKeys) {
      const value = metrics[metric]
      if (!(metric in post.metrics) && typeof value === 'number' && Number.isFinite(value)) {
        post.metrics[metric] = value
      }
    }
    latestByPost.set(key, post)
  }

  const grouped = new Map<string, {
    channel: string
    latest_captured_at: number
    unique_posts: number
    views: number
    impressions: number
    reach: number
    profile_visits: number
    link_clicks: number
    website_visits: number
    website_unique_visitors: number
    likes: number
    comments: number
    shares: number
    saves: number
    follows: number
    signup: number
    activation: number
    conversion: number
  }>()

  for (const post of latestByPost.values()) {
    const item = grouped.get(post.channel) || {
      channel: post.channel,
      latest_captured_at: 0,
      unique_posts: 0,
      views: 0,
      impressions: 0,
      reach: 0,
      profile_visits: 0,
      link_clicks: 0,
      website_visits: 0,
      website_unique_visitors: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      follows: 0,
      signup: 0,
      activation: 0,
      conversion: 0,
    }
    item.unique_posts += 1
    item.latest_captured_at = Math.max(item.latest_captured_at, post.latest_captured_at)
    for (const key of metricKeys) {
      const value = post.metrics[key]
      if (typeof value === 'number' && Number.isFinite(value)) item[key] += value
    }
    grouped.set(post.channel, item)
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      snapshots: snapshotCounts.get(item.channel) || 0,
      ctr: (item.impressions || item.views || item.reach) > 0 ? item.link_clicks / (item.impressions || item.views || item.reach) : null,
      click_to_visit_rate: item.link_clicks > 0 ? item.website_visits / item.link_clicks : null,
      visitor_to_signup_rate: (item.website_unique_visitors || item.website_visits) > 0 ? item.signup / (item.website_unique_visitors || item.website_visits) : null,
      signup_conversion: item.link_clicks > 0 ? item.signup / item.link_clicks : null,
      activation_conversion: item.signup > 0 ? item.activation / item.signup : null,
    }))
    .sort((a, b) => b.latest_captured_at - a.latest_captured_at)
}
