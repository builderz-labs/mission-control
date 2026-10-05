import type { NormalizedSocialMetrics, SocialMetricInput } from './social-metrics'

export interface SocialLearningObservation {
  identity: {
    channel: string
    account_ref: string
    post_id: string
    post_url: string | null
    content_id: string
    campaign_id: string | null
  }
  measurement_window: string | null
  content_intelligence: Record<string, string>
  canonical_metrics: SocialMetricInput['metrics']
  normalized_metrics: NormalizedSocialMetrics
  attribution: SocialMetricInput['attribution']
  interpretation_policy: 'observation_only_no_winner_without_baseline'
}

export function buildSocialLearningObservation(
  input: SocialMetricInput,
  normalized: NormalizedSocialMetrics,
): SocialLearningObservation {
  return {
    identity: {
      channel: input.channel,
      account_ref: input.account_ref,
      post_id: input.post_id,
      post_url: input.post_url || null,
      content_id: input.content_id,
      campaign_id: input.campaign_id || null,
    },
    measurement_window: input.measurement_window || null,
    content_intelligence: { ...(input.content_intelligence || {}) },
    canonical_metrics: { ...input.metrics },
    normalized_metrics: { ...normalized },
    attribution: { ...(input.attribution || {}) },
    interpretation_policy: 'observation_only_no_winner_without_baseline',
  }
}
