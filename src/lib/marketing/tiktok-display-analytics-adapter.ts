import type {
  SocialAnalyticsAdapter,
  SocialAnalyticsFetchRequest,
  SocialAnalyticsObservation,
} from './social-analytics-adapter'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface TikTokVideo {
  id?: string
  view_count?: number
  like_count?: number
  comment_count?: number
  share_count?: number
}

interface TikTokVideoQueryResponse {
  data?: { videos?: TikTokVideo[] }
  error?: { code?: string; message?: string; log_id?: string }
}

const TIKTOK_VIDEO_QUERY_URL =
  'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count'

export class TikTokDisplayAnalyticsAdapter implements SocialAnalyticsAdapter {
  readonly id = 'tiktok-display-v2'
  readonly channels = ['tiktok'] as const
  readonly source_type = 'official_api' as const
  readonly network_access = true
  readonly requires_credentials = true

  private readonly accessToken: string
  private readonly fetchImpl: FetchLike

  constructor(input: { accessToken: string; fetchImpl?: FetchLike }) {
    const token = input.accessToken.trim()
    if (!token) throw new Error('TikTok Display API access token is required.')
    this.accessToken = token
    this.fetchImpl = input.fetchImpl || fetch
  }

  async fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    if (request.identity.channel !== 'tiktok') {
      throw new Error('TikTok adapter only accepts TikTok post identities.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let response: Response
    try {
      response = await this.fetchImpl(TIKTOK_VIDEO_QUERY_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filters: { video_ids: [request.identity.post_id] } }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new Error(`TikTok Display API request failed with HTTP ${response.status}.`)
    }

    const payload = await response.json() as TikTokVideoQueryResponse
    if (payload.error?.code && payload.error.code !== 'ok') {
      throw new Error(`TikTok Display API returned error code ${payload.error.code}.`)
    }

    const video = payload.data?.videos?.find((item) => item.id === request.identity.post_id)
    if (!video) throw new Error('TikTok Display API did not return the requested owned video.')

    const raw_platform_metrics = {
      view_count: video.view_count ?? null,
      like_count: video.like_count ?? null,
      comment_count: video.comment_count ?? null,
      share_count: video.share_count ?? null,
    }

    return {
      source_type: 'official_api',
      source_ref: `tiktok-display-v2:video-query:${request.identity.post_id}`,
      verification_state: 'verified',
      metrics: {
        views: video.view_count ?? null,
        likes: video.like_count ?? null,
        comments: video.comment_count ?? null,
        shares: video.share_count ?? null,
      },
      raw_platform_metrics,
      cost: { paid_usd: 0, local_compute: false },
    }
  }
}

export const tiktokDisplayAnalyticsSurface = {
  endpoint: TIKTOK_VIDEO_QUERY_URL,
  scope: 'video.list',
  max_video_ids_per_query: 20,
  canonical_metrics: ['views', 'likes', 'comments', 'shares'],
} as const
