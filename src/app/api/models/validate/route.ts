import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'

const PROVIDER_VALIDATION: Record<string, { url: string; authHeader: (key: string) => Record<string, string> }> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }),
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
}

/**
 * POST /api/models/validate - Validate an API key against a provider
 * Body: { provider, api_key, base_url? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const { provider, api_key, base_url } = body as { provider?: string; api_key?: string; base_url?: string }

    if (!provider || !api_key) {
      return NextResponse.json({ error: 'provider and api_key are required' }, { status: 400 })
    }

    const providerConfig = PROVIDER_VALIDATION[provider]
    const url = base_url || providerConfig?.url
    if (!url) {
      return NextResponse.json({
        valid: false,
        error: `Unknown provider "${provider}" — provide a base_url to validate`,
      })
    }

    const headers = providerConfig
      ? providerConfig.authHeader(api_key)
      : { 'Authorization': `Bearer ${api_key}` }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      // For Anthropic, we need to POST; for others GET /models works
      let res: Response
      if (provider === 'anthropic') {
        res = await fetch(url, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        })
      } else {
        res = await fetch(base_url || url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
      }

      if (res.ok) {
        return NextResponse.json({ valid: true })
      } else if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ valid: false, error: 'Invalid API key' })
      } else if (res.status === 429) {
        return NextResponse.json({ valid: true, warning: 'Key is valid but currently rate-limited' })
      } else {
        const text = await res.text().catch(() => '')
        return NextResponse.json({ valid: false, error: `Provider returned ${res.status}: ${text.slice(0, 200)}` })
      }
    } catch (fetchErr: any) {
      return NextResponse.json({
        valid: false,
        error: fetchErr?.name === 'AbortError' ? 'Validation timed out' : (fetchErr?.message || 'Connection failed'),
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
