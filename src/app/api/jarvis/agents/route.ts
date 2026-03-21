import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

const JARVIS_REGISTRY_URL = 'https://mc.offerlogix.me/api/agents'

/**
 * GET /api/jarvis/agents
 *
 * Proxies the live JARVIS agent registry. No caching — always fetches fresh.
 *
 * Authentication: MC session/API key (operator or higher) required on the
 * inbound request. Outbound call to JARVIS uses the JARVIS_API_KEY env var.
 *
 * Returns the raw registry payload:
 *   { agents: Array<{ id, name, description, ... }> }
 *
 * On registry failure the response carries HTTP 502 so callers can distinguish
 * a registry outage from a local auth failure.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const apiKey = process.env.JARVIS_API_KEY
  if (!apiKey) {
    logger.error('JARVIS_API_KEY env var is not set')
    return NextResponse.json(
      { error: 'JARVIS_API_KEY is not configured on this server' },
      { status: 500 },
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(JARVIS_REGISTRY_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      logger.warn({ status: res.status, url: JARVIS_REGISTRY_URL }, 'JARVIS registry returned non-2xx')
      return NextResponse.json(
        { error: `JARVIS registry returned ${res.status}` },
        { status: 502 },
      )
    }

    const data = await res.json()

    // Normalise to a consistent shape regardless of what the remote returns.
    // The dispatch form only needs id, name, description.
    const raw: unknown[] = Array.isArray(data) ? data : (data?.agents ?? data?.data ?? [])
    const agents = (raw as any[]).map((a) => ({
      id: a.id ?? a.agent_id ?? a.slug ?? String(a.name ?? ''),
      name: a.name ?? a.display_name ?? a.id ?? 'Unknown',
      description: a.description ?? a.role ?? a.soul ?? '',
      status: a.status ?? null,
      webhook_url: a.webhook_url ?? a.webhookUrl ?? a.webhook ?? null,
    }))

    return NextResponse.json({ agents, total: agents.length })
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      logger.warn({ url: JARVIS_REGISTRY_URL }, 'JARVIS registry request timed out')
      return NextResponse.json({ error: 'JARVIS registry timed out' }, { status: 504 })
    }
    logger.error({ err }, 'JARVIS registry fetch failed')
    return NextResponse.json({ error: 'Could not reach JARVIS registry' }, { status: 502 })
  }
}
