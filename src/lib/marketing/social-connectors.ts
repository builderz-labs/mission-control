import type { SocialChannel } from './social-metrics'

export type ConnectorReadiness = 'MANUAL_OR_EXPORT' | 'READY_FOR_CREDENTIALS' | 'HOLD'

export interface SocialConnectorProfile {
  channel: SocialChannel
  current_readiness: ConnectorReadiness
  preferred_source: 'official_api'
  official_surface: string
  credential_requirements: string[]
  organic_metrics: string[]
  open_source_candidates: Array<{
    name: string
    source: string
    adoption: 'CANDIDATE' | 'HOLD'
    scope: string
  }>
  notes: string[]
}

export const socialConnectorRegistry: readonly SocialConnectorProfile[] = [
  {
    channel: 'instagram',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'Meta Instagram Graph API / Insights for Business or Creator accounts',
    credential_requirements: ['Meta developer app', 'eligible Instagram Business/Creator account', 'approved insight scopes'],
    organic_metrics: ['reach', 'views/impressions where available', 'follower_count', 'media engagement', 'media insights'],
    open_source_candidates: [
      {
        name: 'Airbyte Instagram source',
        source: 'airbytehq/airbyte',
        adoption: 'CANDIDATE',
        scope: 'Organic account/media/story insights; useful if connector operations justify Airbyte later.',
      },
    ],
    notes: ['Do not require Airbyte for the first 100 users; direct official API or export is cheaper.'],
  },
  {
    channel: 'tiktok',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'TikTok Display API + eligible creator/business analytics surfaces',
    credential_requirements: ['TikTok developer app', 'Login Kit/API approval for selected scopes', 'eligible account/API product'],
    organic_metrics: ['public video metadata/counts where exposed', 'views', 'likes', 'comments', 'shares', 'creator analytics via eligible surfaces/export'],
    open_source_candidates: [
      {
        name: 'Airbyte TikTok Marketing',
        source: 'airbytehq/airbyte',
        adoption: 'HOLD',
        scope: 'Ads/marketing reporting, not the default source for organic creator performance.',
      },
      {
        name: 'Singer tap-tiktok-ads',
        source: 'singer-io/tap-tiktok-ads',
        adoption: 'HOLD',
        scope: 'Ads reporting only; keep separate from organic content learning.',
      },
    ],
    notes: ['Watch-time/completion must stay null unless an authorized source actually provides it.'],
  },
  {
    channel: 'linkedin',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'LinkedIn Community Management / Member & Organization analytics APIs',
    credential_requirements: ['LinkedIn developer app', 'approved Community Management/member analytics access', 'required admin/member scopes'],
    organic_metrics: ['impressions', 'members reached', 'reactions/likes', 'comments', 'shares', 'link clicks', 'profile/page views', 'followers', 'video analytics where available'],
    open_source_candidates: [
      {
        name: 'Singer tap-linkedin-ads',
        source: 'singer-io/tap-linkedin-ads',
        adoption: 'HOLD',
        scope: 'Ads analytics; not a substitute for organic member/company post analytics.',
      },
      {
        name: 'Airbyte LinkedIn Ads',
        source: 'airbytehq/airbyte',
        adoption: 'HOLD',
        scope: 'Ads pipeline only until paid acquisition becomes material.',
      },
    ],
    notes: ['Use organic Community Management/member analytics before ads connectors.'],
  },
  {
    channel: 'x',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'X API v2 post/user metrics subject to active access plan and authorization',
    credential_requirements: ['X developer project/app', 'approved access plan', 'user/app token with required fields/scopes'],
    organic_metrics: ['public_metrics', 'likes', 'replies', 'reposts', 'quotes', 'impressions/non-public or organic metrics only when authorization allows'],
    open_source_candidates: [
      {
        name: 'Airbyte Twitter/X source',
        source: 'airbytehq/airbyte',
        adoption: 'HOLD',
        scope: 'Beta/limited stream coverage; direct API is simpler at current scale.',
      },
    ],
    notes: ['Do not assume impressions/private metrics are available on every X plan.'],
  },
  {
    channel: 'threads',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'Meta Threads API / Insights when app and insight scopes are approved',
    credential_requirements: ['Meta developer app', 'Threads account authorization', 'eligible insight scopes'],
    organic_metrics: ['views/reach and engagement metrics only where the authorized Threads Insights surface exposes them'],
    open_source_candidates: [],
    notes: ['No separate third-party connector is adopted yet; prefer a thin official adapter when credentials are ready.'],
  },
  {
    channel: 'reddit',
    current_readiness: 'MANUAL_OR_EXPORT',
    preferred_source: 'official_api',
    official_surface: 'Reddit API for owned post/community metadata plus first-party UTM analytics',
    credential_requirements: ['Reddit developer app/account authorization where API access is used'],
    organic_metrics: ['score', 'upvote ratio where available', 'comments', 'post metadata; impressions are not assumed'],
    open_source_candidates: [],
    notes: ['Keep Reddit score/upvote ratio in raw_platform_metrics; do not normalize it as views or reach.', 'Use UTM web analytics for click and conversion learning.'],
  },
] as const

export function getSocialConnectorProfile(channel: SocialChannel): SocialConnectorProfile {
  const profile = socialConnectorRegistry.find((item) => item.channel === channel)
  if (!profile) throw new Error(`Unknown social channel: ${channel}`)
  return profile
}
