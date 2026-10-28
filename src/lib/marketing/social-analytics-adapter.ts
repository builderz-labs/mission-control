import { z } from 'zod'
import {
  SOCIAL_CHANNELS,
  SOCIAL_MEASUREMENT_WINDOWS,
  SOCIAL_SOURCE_TYPES,
  socialMetricInputSchema,
  socialPostIdentitySchema,
  type SocialChannel,
  type SocialMetricInput,
  type SocialPostIdentity,
  type SocialSourceType,
} from './social-metrics'

const rawMetricValueSchema = z.union([z.number().finite(), z.string(), z.boolean(), z.null()])

export const socialAnalyticsFetchRequestSchema = z.object({
  identity: socialPostIdentitySchema,
  measurement_window: z.enum(SOCIAL_MEASUREMENT_WINDOWS),
  captured_at: z.number().int().positive(),
  attribution: z.object({
    utm_source: z.string().trim().max(200).nullable().optional(),
    utm_medium: z.string().trim().max(200).nullable().optional(),
    utm_campaign: z.string().trim().max(300).nullable().optional(),
    utm_content: z.string().trim().max(300).nullable().optional(),
    landing_url: z.string().trim().max(2000).nullable().optional(),
  }).optional().default({}),
}).strict()

export type SocialAnalyticsFetchRequest = z.infer<typeof socialAnalyticsFetchRequestSchema>

export const socialAnalyticsObservationSchema = z.object({
  source_type: z.enum(SOCIAL_SOURCE_TYPES),
  source_ref: z.string().trim().min(1).max(1000),
  verification_state: z.enum(['verified', 'unverified']),
  metrics: socialMetricInputSchema.shape.metrics,
  raw_platform_metrics: z.record(z.string(), rawMetricValueSchema).optional().default({}),
  cost: z.object({
    paid_usd: z.number().finite().nonnegative(),
    local_compute: z.boolean().optional(),
  }).strict(),
}).strict()

export type SocialAnalyticsObservation = z.infer<typeof socialAnalyticsObservationSchema>

export interface SocialAnalyticsAdapter {
  readonly id: string
  readonly channels: readonly SocialChannel[]
  readonly source_type: SocialSourceType
  readonly network_access: boolean
  readonly requires_credentials: boolean
  fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation>
}

export function buildVerifiedSocialMetricInput(
  adapter: SocialAnalyticsAdapter,
  request: SocialAnalyticsFetchRequest,
  observation: SocialAnalyticsObservation,
): SocialMetricInput {
  const parsedRequest = socialAnalyticsFetchRequestSchema.parse(request)
  const parsedObservation = socialAnalyticsObservationSchema.parse(observation)
  if (!adapter.channels.includes(parsedRequest.identity.channel)) {
    throw new Error(`Analytics adapter ${adapter.id} does not support channel ${parsedRequest.identity.channel}.`)
  }
  if (parsedObservation.source_type !== adapter.source_type) {
    throw new Error(`Analytics adapter ${adapter.id} returned an unexpected source type.`)
  }
  if (parsedObservation.verification_state !== 'verified') {
    throw new Error('Unverified social analytics observations cannot enter the canonical metric store.')
  }

  const identity: SocialPostIdentity = parsedRequest.identity
  return socialMetricInputSchema.parse({
    channel: identity.channel,
    account_ref: identity.account_ref,
    post_id: identity.post_id,
    post_url: identity.post_url,
    content_id: identity.content_id,
    campaign_id: identity.campaign_id,
    published_at: identity.published_at,
    captured_at: parsedRequest.captured_at,
    source_type: parsedObservation.source_type,
    source_ref: parsedObservation.source_ref,
    measurement_window: parsedRequest.measurement_window,
    raw_platform_metrics: parsedObservation.raw_platform_metrics,
    metrics: parsedObservation.metrics,
    attribution: parsedRequest.attribution,
  })
}

export function supportsSocialChannel(adapter: SocialAnalyticsAdapter, channel: SocialChannel): boolean {
  return adapter.channels.includes(channel)
}

export const socialAnalyticsContract = {
  channels: SOCIAL_CHANNELS,
  measurement_windows: SOCIAL_MEASUREMENT_WINDOWS,
  source_types: SOCIAL_SOURCE_TYPES,
} as const
