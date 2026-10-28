import type {
  SocialAnalyticsAdapter,
  SocialAnalyticsFetchRequest,
  SocialAnalyticsObservation,
} from './social-analytics-adapter'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type MetricBag = Record<string, number | undefined>

interface XPost {
  id?: string
  public_metrics?: MetricBag
  non_public_metrics?: MetricBag
  organic_metrics?: MetricBag
}

interface XPostResponse {
  data?: XPost
  errors?: Array<{ title?: string; detail?: string; type?: string }>
}

const X_POST_FIELDS = 'public_metrics,non_public_metrics,organic_metrics'
const X_POST_LOOKUP_BASE = 'https://api.x.com/2/tweets'

function firstFinite(...values: Array<number | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

export class XPostAnalyticsAdapter implements SocialAnalyticsAdapter {
  readonly id = 'x-post-v2'
  readonly channels = ['x'] as const
  readonly source_type = 'official_api' as const
  readonly network_access = true
  readonly requires_credentials = true

  private readonly accessToken: string
  private readonly fetchImpl: FetchLike

  constructor(input: { accessToken: string; fetchImpl?: FetchLike }) {
    const token = input.accessToken.trim()
    if (!token) throw new Error('X API user access token is required.')
    this.accessToken = token
    this.fetchImpl = input.fetchImpl || fetch
  }

  async fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    if (request.identity.channel !== 'x') {
      throw new Error('X adapter only accepts X post identities.')
    }

    const url = new URL(`${X_POST_LOOKUP_BASE}/${encodeURIComponent(request.identity.post_id)}`)
    url.searchParams.set('tweet.fields', X_POST_FIELDS)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new Error(`X API request failed with HTTP ${response.status}.`)
    }

    const payload = await response.json() as XPostResponse
    if (payload.errors?.length) {
      throw new Error(`X API returned error: ${payload.errors[0]?.title || payload.errors[0]?.detail || 'unknown'}.`)
    }
    const post = payload.data
    if (!post || post.id !== request.identity.post_id) {
      throw new Error('X API did not return the requested owned post.')
    }

    const pub = post.public_metrics || {}
    const non = post.non_public_metrics || {}
    const org = post.organic_metrics || {}

    const impressions = firstFinite(
      non.impression_count,
      org.impression_count,
      pub.impression_count,
    )
    const likes = firstFinite(pub.like_count, org.like_count)
    const comments = firstFinite(pub.reply_count, org.reply_count)
    const reposts = firstFinite(
      pub.retweet_count,
      pub.repost_count,
      org.retweet_count,
      org.repost_count,
    )
    const saves = firstFinite(pub.bookmark_count, org.bookmark_count)
    const linkClicks = firstFinite(non.url_link_clicks, org.url_link_clicks)
    const profileVisits = firstFinite(non.user_profile_clicks, org.user_profile_clicks)

    const raw_platform_metrics = {
      public_metrics: JSON.stringify(pub),
      non_public_metrics: JSON.stringify(non),
      organic_metrics: JSON.stringify(org),
    }

    return {
      source_type: 'official_api',
      source_ref: `x-v2:tweet:${request.identity.post_id}`,
      verification_state: 'verified',
      metrics: {
        impressions,
        likes,
        comments,
        reposts,
        saves,
        link_clicks: linkClicks,
        profile_visits: profileVisits,
      },
      raw_platform_metrics,
      cost: { paid_usd: 0, local_compute: false },
    }
  }
}

export const xPostAnalyticsSurface = {
  endpoint: X_POST_LOOKUP_BASE,
  fields: X_POST_FIELDS,
  auth: 'user-context bearer token for non_public_metrics/organic_metrics; plan/access dependent',
  canonical_metrics: ['impressions', 'likes', 'comments', 'reposts', 'saves', 'link_clicks', 'profile_visits'],
} as const
