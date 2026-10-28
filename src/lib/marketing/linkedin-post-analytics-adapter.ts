import type {
  SocialAnalyticsAdapter,
  SocialAnalyticsFetchRequest,
  SocialAnalyticsObservation,
} from './social-analytics-adapter'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type LinkedInMode = 'member' | 'organization'

interface OrgStats {
  uniqueImpressionsCount?: number
  clickCount?: number
  engagement?: number
  likeCount?: number
  commentCount?: number
  shareCount?: number
  impressionCount?: number
}
interface OrgResponse {
  elements?: Array<{
    organizationalEntity?: string
    share?: string
    ugcPost?: string
    totalShareStatistics?: OrgStats
  }>
  message?: string
}
interface MemberResponse {
  elements?: Array<{
    count?: number
    metricType?: string | Record<string, string>
  }>
  message?: string
}

const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest'
const LINKEDIN_VERSION = '202609'
const MEMBER_METRICS = [
  'IMPRESSION',
  'MEMBERS_REACHED',
  'RESHARE',
  'REACTION',
  'COMMENT',
  'POST_SAVE',
  'LINK_CLICKS',
  'FOLLOWER_GAINED_FROM_CONTENT',
  'PROFILE_VIEW_FROM_CONTENT',
] as const

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

function linkedInHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  }
}

function memberEntityParam(postUrn: string): string {
  if (postUrn.startsWith('urn:li:ugcPost:')) return `(ugc:${postUrn})`
  if (postUrn.startsWith('urn:li:share:')) return `(share:${postUrn})`
  throw new Error('LinkedIn member analytics requires a share or ugcPost URN as post_id.')
}

export class LinkedInPostAnalyticsAdapter implements SocialAnalyticsAdapter {
  readonly id = 'linkedin-post-analytics-202609'
  readonly channels = ['linkedin'] as const
  readonly source_type = 'official_api' as const
  readonly network_access = true
  readonly requires_credentials = true

  private readonly accessToken: string
  private readonly mode: LinkedInMode
  private readonly organizationUrn: string | null
  private readonly fetchImpl: FetchLike

  constructor(input: {
    accessToken: string
    mode: LinkedInMode
    organizationUrn?: string
    fetchImpl?: FetchLike
  }) {
    const token = input.accessToken.trim()
    if (!token) throw new Error('LinkedIn API access token is required.')
    if (input.mode === 'organization') {
      const urn = input.organizationUrn?.trim() || ''
      if (!/^urn:li:organization(?:Brand)?:\d+$/.test(urn)) {
        throw new Error('LinkedIn organization mode requires a valid organization URN.')
      }
      this.organizationUrn = urn
    } else {
      this.organizationUrn = null
    }
    this.accessToken = token
    this.mode = input.mode
    this.fetchImpl = input.fetchImpl || fetch
  }

  async fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    if (request.identity.channel !== 'linkedin') {
      throw new Error('LinkedIn adapter only accepts LinkedIn post identities.')
    }
    return this.mode === 'organization'
      ? this.fetchOrganizationMetrics(request)
      : this.fetchMemberMetrics(request)
  }

  private async fetchOrganizationMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    const postUrn = request.identity.post_id
    const url = new URL(`${LINKEDIN_API_BASE}/organizationalEntityShareStatistics`)
    url.searchParams.set('q', 'organizationalEntity')
    url.searchParams.set('organizationalEntity', this.organizationUrn!)
    if (postUrn.startsWith('urn:li:share:')) {
      url.searchParams.set('shares', `List(${postUrn})`)
    } else if (postUrn.startsWith('urn:li:ugcPost:')) {
      url.searchParams.set('ugcPosts[0]', postUrn)
    } else {
      throw new Error('LinkedIn organization analytics requires a share or ugcPost URN as post_id.')
    }

    const payload = await this.fetchJson<OrgResponse>(url)
    const match = (payload.elements || []).find((item) =>
      item.share === postUrn || item.ugcPost === postUrn,
    )
    const stats = match?.totalShareStatistics || {}
    // LinkedIn documents that a requested specific share omitted from elements can be treated as zero activity.
    const emptyVerified = !match && Array.isArray(payload.elements)

    return {
      source_type: 'official_api',
      source_ref: `linkedin-202609:organization:${postUrn}`,
      verification_state: 'verified',
      metrics: {
        impressions: finite(stats.impressionCount) ?? (emptyVerified ? 0 : null),
        reach: finite(stats.uniqueImpressionsCount) ?? (emptyVerified ? 0 : null),
        link_clicks: finite(stats.clickCount) ?? (emptyVerified ? 0 : null),
        likes: finite(stats.likeCount) ?? (emptyVerified ? 0 : null),
        comments: finite(stats.commentCount) ?? (emptyVerified ? 0 : null),
        shares: finite(stats.shareCount) ?? (emptyVerified ? 0 : null),
      },
      raw_platform_metrics: {
        engagement: finite(stats.engagement),
        mode: 'organization',
        linkedin_version: LINKEDIN_VERSION,
      },
      cost: { paid_usd: 0, local_compute: false },
    }
  }

  private async fetchMemberMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    const postUrn = request.identity.post_id
    const entity = memberEntityParam(postUrn)
    const values = new Map<string, number>()

    for (const metric of MEMBER_METRICS) {
      const url = new URL(`${LINKEDIN_API_BASE}/memberCreatorPostAnalytics`)
      url.searchParams.set('q', 'entity')
      url.searchParams.set('entity', entity)
      url.searchParams.set('queryType', metric)
      url.searchParams.set('aggregation', 'TOTAL')
      const payload = await this.fetchJson<MemberResponse>(url)
      const count = payload.elements?.[0]?.count
      if (typeof count === 'number' && Number.isFinite(count)) values.set(metric, Math.max(0, count))
    }

    return {
      source_type: 'official_api',
      source_ref: `linkedin-202609:member:${postUrn}`,
      verification_state: 'verified',
      metrics: {
        impressions: values.get('IMPRESSION') ?? null,
        reach: values.get('MEMBERS_REACHED') ?? null,
        reposts: values.get('RESHARE') ?? null,
        likes: values.get('REACTION') ?? null,
        comments: values.get('COMMENT') ?? null,
        saves: values.get('POST_SAVE') ?? null,
        link_clicks: values.get('LINK_CLICKS') ?? null,
        follows: values.get('FOLLOWER_GAINED_FROM_CONTENT') ?? null,
        profile_visits: values.get('PROFILE_VIEW_FROM_CONTENT') ?? null,
      },
      raw_platform_metrics: {
        member_metric_requests: MEMBER_METRICS.length,
        mode: 'member',
        linkedin_version: LINKEDIN_VERSION,
      },
      cost: { paid_usd: 0, local_compute: false },
    }
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: linkedInHeaders(this.accessToken),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) throw new Error(`LinkedIn API request failed with HTTP ${response.status}.`)
    const payload = await response.json() as T & { message?: string }
    if (payload.message && !('elements' in payload)) throw new Error(`LinkedIn API returned error: ${payload.message}`)
    return payload
  }
}

export const linkedInAnalyticsSurface = {
  version: LINKEDIN_VERSION,
  member_endpoint: `${LINKEDIN_API_BASE}/memberCreatorPostAnalytics`,
  organization_endpoint: `${LINKEDIN_API_BASE}/organizationalEntityShareStatistics`,
  member_permission: 'r_member_postAnalytics',
  organization_permissions: ['r_organization_social', 'organization admin/content role'],
  member_metrics: MEMBER_METRICS,
} as const
