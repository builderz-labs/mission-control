import type {
  SocialAnalyticsAdapter,
  SocialAnalyticsFetchRequest,
  SocialAnalyticsObservation,
} from './social-analytics-adapter'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface InstagramInsightValue {
  value?: number
}

interface InstagramInsight {
  name?: string
  values?: InstagramInsightValue[]
  total_value?: { value?: number }
}

interface InstagramInsightsResponse {
  data?: InstagramInsight[]
  error?: { message?: string; type?: string; code?: number }
}

const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com/v26.0'
const MEDIA_INSIGHT_METRICS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'] as const

function metricValue(item: InstagramInsight | undefined): number | null {
  const value = item?.values?.[0]?.value ?? item?.total_value?.value
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export class InstagramMediaAnalyticsAdapter implements SocialAnalyticsAdapter {
  readonly id = 'instagram-media-insights-v26'
  readonly channels = ['instagram'] as const
  readonly source_type = 'official_api' as const
  readonly network_access = true
  readonly requires_credentials = true

  private readonly accessToken: string
  private readonly fetchImpl: FetchLike

  constructor(input: { accessToken: string; fetchImpl?: FetchLike }) {
    const token = input.accessToken.trim()
    if (!token) throw new Error('Instagram API access token is required.')
    this.accessToken = token
    this.fetchImpl = input.fetchImpl || fetch
  }

  async fetchMetrics(request: SocialAnalyticsFetchRequest): Promise<SocialAnalyticsObservation> {
    if (request.identity.channel !== 'instagram') {
      throw new Error('Instagram adapter only accepts Instagram media identities.')
    }

    const url = new URL(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(request.identity.post_id)}/insights`)
    url.searchParams.set('metric', MEDIA_INSIGHT_METRICS.join(','))

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
      throw new Error(`Instagram Insights API request failed with HTTP ${response.status}.`)
    }

    const payload = await response.json() as InstagramInsightsResponse
    if (payload.error) {
      throw new Error(`Instagram Insights API returned error ${payload.error.code ?? 'unknown'}: ${payload.error.message || payload.error.type || 'unknown'}.`)
    }

    const items = new Map((payload.data || []).map((item) => [item.name, item]))
    if (!payload.data || payload.data.length === 0) {
      throw new Error('Instagram Insights API returned no metrics for the requested owned media.')
    }

    const views = metricValue(items.get('views'))
    const reach = metricValue(items.get('reach'))
    const likes = metricValue(items.get('likes'))
    const comments = metricValue(items.get('comments'))
    const saves = metricValue(items.get('saved'))
    const shares = metricValue(items.get('shares'))
    const totalInteractions = metricValue(items.get('total_interactions'))

    const raw_platform_metrics = Object.fromEntries(
      (payload.data || []).map((item) => [item.name || 'unknown', metricValue(item)]),
    )

    return {
      source_type: 'official_api',
      source_ref: `instagram-v26:media-insights:${request.identity.post_id}`,
      verification_state: 'verified',
      metrics: {
        views,
        reach,
        likes,
        comments,
        saves,
        shares,
      },
      raw_platform_metrics: {
        ...raw_platform_metrics,
        total_interactions: totalInteractions,
      },
      cost: { paid_usd: 0, local_compute: false },
    }
  }
}

export const instagramMediaAnalyticsSurface = {
  endpoint: `${INSTAGRAM_GRAPH_BASE}/{media-id}/insights`,
  metrics: MEDIA_INSIGHT_METRICS,
  account_requirement: 'Instagram Professional account (Business or Creator)',
  canonical_metrics: ['views', 'reach', 'likes', 'comments', 'saves', 'shares'],
} as const
