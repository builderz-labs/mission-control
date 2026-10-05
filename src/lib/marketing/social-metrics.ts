import { createHash } from 'node:crypto'
import { z } from 'zod'

export const SOCIAL_CHANNELS = ['instagram', 'tiktok', 'linkedin', 'x', 'threads', 'reddit'] as const
export type SocialChannel = typeof SOCIAL_CHANNELS[number]

export const SOCIAL_MEASUREMENT_WINDOWS = ['1h', '6h', '24h', '72h', '7d', 'custom'] as const
export type SocialMeasurementWindow = typeof SOCIAL_MEASUREMENT_WINDOWS[number]

export const SOCIAL_SOURCE_TYPES = ['manual', 'official_api', 'first_party_analytics', 'import'] as const
export type SocialSourceType = typeof SOCIAL_SOURCE_TYPES[number]

const nullableMetric = z.number().finite().nonnegative().nullable().optional()
const nullableRate = z.number().finite().min(0).max(1).nullable().optional()
const rawMetricValueSchema = z.union([z.number().finite(), z.string(), z.boolean(), z.null()])

export const socialPostIdentitySchema = z.object({
  channel: z.enum(SOCIAL_CHANNELS),
  account_ref: z.string().trim().min(1).max(500),
  post_id: z.string().trim().min(1).max(500),
  content_id: z.string().trim().min(1).max(500),
  campaign_id: z.string().trim().min(1).max(500).nullable().optional(),
  published_at: z.number().int().nonnegative().nullable().optional(),
  post_url: z.string().url().nullable().optional(),
}).strict()

export type SocialPostIdentity = z.infer<typeof socialPostIdentitySchema>

export const socialMetricInputSchema = z.object({
  channel: z.enum(SOCIAL_CHANNELS),
  account_ref: z.string().trim().min(1).max(500),
  post_id: z.string().trim().min(1).max(500),
  content_id: z.string().trim().min(1).max(500),
  campaign_id: z.string().trim().min(1).max(500).nullable().optional(),
  published_at: z.number().int().nonnegative().nullable().optional(),
  captured_at: z.number().int().positive(),
  source_type: z.enum(SOCIAL_SOURCE_TYPES),
  source_ref: z.string().trim().min(1).max(1000),
  measurement_window: z.enum(SOCIAL_MEASUREMENT_WINDOWS).optional(),
  raw_platform_metrics: z.record(z.string(), rawMetricValueSchema).optional(),
  creative_variant: z.string().trim().max(300).nullable().optional(),
  hook_variant: z.string().trim().max(300).nullable().optional(),
  cta_variant: z.string().trim().max(300).nullable().optional(),
  metrics: z.object({
    impressions: nullableMetric,
    views: nullableMetric,
    reach: nullableMetric,
    profile_visits: nullableMetric,
    link_clicks: nullableMetric,
    website_visits: nullableMetric,
    website_unique_visitors: nullableMetric,
    likes: nullableMetric,
    comments: nullableMetric,
    shares: nullableMetric,
    reposts: nullableMetric,
    saves: nullableMetric,
    follows: nullableMetric,
    follower_delta: z.number().finite().nullable().optional(),
    watch_time_seconds: nullableMetric,
    average_watch_time_seconds: nullableMetric,
    completion_rate: nullableRate,
    video_25_rate: nullableRate,
    video_50_rate: nullableRate,
    video_75_rate: nullableRate,
    video_100_rate: nullableRate,
    signup: nullableMetric,
    activation: nullableMetric,
    conversion: nullableMetric,
    spend_usd: nullableMetric,
  }),
  attribution: z.object({
    utm_source: z.string().trim().max(200).nullable().optional(),
    utm_medium: z.string().trim().max(200).nullable().optional(),
    utm_campaign: z.string().trim().max(300).nullable().optional(),
    utm_content: z.string().trim().max(300).nullable().optional(),
    landing_url: z.string().trim().max(2000).nullable().optional(),
  }).optional().default({}),
})

export type SocialMetricInput = z.infer<typeof socialMetricInputSchema>

export interface NormalizedSocialMetrics {
  exposure: number | null
  engagement_actions: number | null
  engagement_rate: number | null
  comment_rate: number | null
  share_rate: number | null
  save_rate: number | null
  click_rate: number | null
  ctr: number | null
  click_to_visit_rate: number | null
  visitor_to_signup_rate: number | null
  visitor_to_conversion_rate: number | null
  follow_conversion: number | null
  signup_conversion: number | null
  activation_conversion: number | null
  completion_rate: number | null
  cpa_usd: number | null
}

export type DerivedSocialMetrics = NormalizedSocialMetrics

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null
  return numerator / denominator
}

export function normalizeSocialMetrics(input: SocialMetricInput): NormalizedSocialMetrics {
  const m = input.metrics
  const exposure = m.reach ?? m.views ?? m.impressions ?? null
  const engagementValues = [m.likes, m.comments, m.shares, m.reposts, m.saves]
    .filter((value): value is number => typeof value === 'number')
  const engagementActions = engagementValues.length > 0
    ? engagementValues.reduce((sum, value) => sum + value, 0)
    : null
  const shareActions = [m.shares, m.reposts]
    .filter((value): value is number => typeof value === 'number')
  const sharesAndReposts = shareActions.length > 0
    ? shareActions.reduce((sum, value) => sum + value, 0)
    : null
  const clickDenominator = m.impressions ?? m.views ?? m.reach ?? null

  return {
    exposure,
    engagement_actions: engagementActions,
    engagement_rate: safeRatio(engagementActions, exposure),
    comment_rate: safeRatio(m.comments, exposure),
    share_rate: safeRatio(sharesAndReposts, exposure),
    save_rate: safeRatio(m.saves, exposure),
    click_rate: safeRatio(m.link_clicks, clickDenominator),
    ctr: safeRatio(m.link_clicks, clickDenominator),
    click_to_visit_rate: safeRatio(m.website_visits, m.link_clicks),
    visitor_to_signup_rate: safeRatio(m.signup, m.website_unique_visitors ?? m.website_visits),
    visitor_to_conversion_rate: safeRatio(m.conversion, m.website_unique_visitors ?? m.website_visits),
    follow_conversion: safeRatio(m.follows ?? m.follower_delta, m.profile_visits ?? exposure),
    signup_conversion: safeRatio(m.signup, m.link_clicks),
    activation_conversion: safeRatio(m.activation, m.signup),
    completion_rate: m.completion_rate ?? null,
    cpa_usd: safeRatio(m.spend_usd, m.conversion ?? m.activation ?? m.signup),
  }
}

export function deriveSocialMetrics(input: SocialMetricInput): DerivedSocialMetrics {
  return normalizeSocialMetrics(input)
}

export function socialSnapshotFingerprint(input: SocialMetricInput): string {
  const normalized = socialMetricInputSchema.parse(input)
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
}

export const platformMetricSupport: Record<SocialChannel, {
  official_api_candidate: boolean
  notes: string[]
}> = {
  instagram: {
    official_api_candidate: true,
    notes: ['Prefer Meta official APIs when account permissions allow.', 'Unavailable metrics remain null; do not infer them.'],
  },
  tiktok: {
    official_api_candidate: true,
    notes: ['Video objects expose public counts; business insights may require approved account/API access.', 'Watch-time availability depends on API product/access.'],
  },
  linkedin: {
    official_api_candidate: true,
    notes: ['Organization analytics require authenticated organization roles/permissions.', 'Member analytics and organization analytics have different access rules.'],
  },
  x: {
    official_api_candidate: true,
    notes: ['API enrollment/access plan may be required.', 'Only request metrics allowed by the active plan and authorization.'],
  },
  threads: {
    official_api_candidate: true,
    notes: ['Meta Threads insights requires app authorization and insights scopes.', 'Unsupported account/post metrics remain null.'],
  },
  reddit: {
    official_api_candidate: true,
    notes: ['Treat Reddit score/upvote ratio as platform-specific raw metrics, not directly comparable cross-channel engagement.', 'Use comments and first-party UTM conversions for normalized learning where available.'],
  },
}
