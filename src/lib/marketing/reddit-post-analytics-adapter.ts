import type {
  SocialAnalyticsAdapter,
  SocialAnalyticsFetchRequest,
  SocialAnalyticsObservation,
} from './social-analytics-adapter'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface RedditPostData {
  name?: string
  id?: string
  author?: string
  score?: number
  upvote_ratio?: number
  num_comments?: number
  subreddit?: string
  permalink?: string
  created_utc?: number
}
interface RedditInfoResponse {
  data?: {
    children?: Array<{
      kind?: string
      data?: RedditPostData
    }>
  }
}

const REDDIT_API_BASE = 'https://oauth.reddit.com'

function normalizeFullname(postId: string): string {
  const trimmed = postId.trim()
  if (/^t3_[a-z0-9]+$/i.test(trimmed)) return trimmed
  if (/^[a-z0-9]+$/i.test(trimmed)) return `t3_${trimmed}`
  throw new Error('Reddit analytics requires a post id or t3_ fullname.')
}

export class RedditPostAnalyticsAdapter implements SocialAnalyticsAdapter {
  readonly id = 'reddit-oauth-info'
  readonly channels = ['reddit'] as const
  readonly source_type = 'official_api' as const
  readonly network_access = true
  readonly requires_credentials = true

  private readonly accessToken: string
  private readonly redditUsername: string
  private readonly userAgent: string
  private readonly fetchImpl: FetchLike

  constructor(input: {
    accessToken: string
    redditUsername: string
    userAgent: string
    fetchImpl?: FetchLike
  }) {
    const token = input.accessToken.trim()
    const username = input.redditUsername.trim().replace(/^u\//i, '')
    const userAgent = input.userAgent.trim()
    if (!token) throw new Error('Reddit OAuth access token is required.')
    if (!username) throw new Error('Reddit username is required for owned-post verification.')
    if (!userAgent) throw new Error('Reddit API requires a descriptive User-Agent.')
    this.accessToken = token
    this.redditUsername = username
    this.userAgent = userAgent
    this.fetchImpl = input.fetchImpl || fetch
  }

  async fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    if (request.identity.channel !== 'reddit') {
      throw new Error('Reddit adapter only accepts Reddit post identities.')
    }

    const fullname = normalizeFullname(request.identity.post_id)
    const url = new URL(`${REDDIT_API_BASE}/api/info`)
    url.searchParams.set('id', fullname)
    url.searchParams.set('raw_json', '1')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `bearer ${this.accessToken}`,
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) throw new Error(`Reddit API request failed with HTTP ${response.status}.`)

    const payload = await response.json() as RedditInfoResponse
    const child = payload.data?.children?.find((item) => item.kind === 't3' && item.data?.name === fullname)
    const post = child?.data
    if (!post) throw new Error('Reddit API did not return the requested post.')

    if ((post.author || '').toLowerCase() !== this.redditUsername.toLowerCase()) {
      throw new Error('Reddit post ownership verification failed.')
    }

    const comments = typeof post.num_comments === 'number' && post.num_comments >= 0 ? post.num_comments : null

    return {
      source_type: 'official_api',
      source_ref: `reddit:api-info:${fullname}`,
      verification_state: 'verified',
      metrics: {
        comments,
      },
      raw_platform_metrics: {
        score: typeof post.score === 'number' ? post.score : null,
        upvote_ratio: typeof post.upvote_ratio === 'number' ? post.upvote_ratio : null,
        num_comments: comments,
        subreddit: post.subreddit || null,
        author: post.author || null,
        permalink: post.permalink || null,
        created_utc: typeof post.created_utc === 'number' ? post.created_utc : null,
      },
      cost: { paid_usd: 0, local_compute: false },
    }
  }
}

export const redditPostAnalyticsSurface = {
  endpoint: `${REDDIT_API_BASE}/api/info`,
  auth: 'OAuth2 bearer token',
  required_client_header: 'descriptive User-Agent',
  canonical_metrics: ['comments'],
  raw_metrics: ['score', 'upvote_ratio', 'num_comments', 'subreddit'],
  note: 'Reddit score/upvote ratio are platform-specific and must not be normalized as reach, views, or impressions.',
} as const
