import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

/**
 * Marketing / Gamma API Proxy
 * Proxies requests to the Gamma public API (https://public-api.gamma.app/v1.0/)
 * API key is stored server-side only — never exposed to the frontend.
 */

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0'

function getGammaKey(): string {
  return process.env.GAMMA_API_KEY ?? ''
}

function gammaHeaders(): Record<string, string> {
  return {
    'X-API-KEY': getGammaKey(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

// GET /api/marketing/gamma?action=themes
export async function GET(req: NextRequest) {
  const auth = requireRole(req, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = req.nextUrl.searchParams.get('action')

  if (!getGammaKey()) {
    return NextResponse.json(
      { error: 'Gamma API key not configured. Add GAMMA_API_KEY to your .env file.' },
      { status: 503 },
    )
  }

  try {
    if (action === 'themes') {
      const res = await fetch(`${GAMMA_BASE}/themes`, { headers: gammaHeaders(), signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`Gamma API error: ${res.status}`)
      const data = await res.json()
      return NextResponse.json(data)
    }

    if (action === 'status') {
      // Quick health check — try to list themes
      try {
        const res = await fetch(`${GAMMA_BASE}/themes`, { headers: gammaHeaders(), signal: AbortSignal.timeout(8000) })
        return NextResponse.json({
          connected: res.ok,
          hasKey: !!getGammaKey(),
          timestamp: new Date().toISOString(),
        })
      } catch {
        return NextResponse.json({ connected: false, hasKey: !!getGammaKey() })
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gamma API error' },
      { status: 502 },
    )
  }
}

// POST /api/marketing/gamma — create a generation
export async function POST(req: NextRequest) {
  const auth = requireRole(req, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!getGammaKey()) {
    return NextResponse.json(
      { error: 'Gamma API key not configured. Add GAMMA_API_KEY to your .env file.' },
      { status: 503 },
    )
  }

  try {
    const body = await req.json()
    const {
      format = 'presentation',
      inputText,
      numCards = 8,
      themeId,
      dimensions,
      cardSplit = 'auto',
      additionalInstructions = '',
      exportAs,
    } = body as {
      format?: string
      inputText: string
      numCards?: number
      themeId?: string
      dimensions?: string
      cardSplit?: string
      additionalInstructions?: string
      exportAs?: string
    }

    if (!inputText) {
      return NextResponse.json({ error: 'inputText is required' }, { status: 400 })
    }

    const payload: Record<string, unknown> = {
      format,
      inputText,
      numCards: Math.min(Math.max(numCards, 1), 60),
      cardSplit,
    }
    if (themeId) payload.themeId = themeId
    if (dimensions) payload.dimensions = dimensions
    if (additionalInstructions) payload.additionalInstructions = additionalInstructions
    if (exportAs && ['pdf', 'pptx'].includes(exportAs)) payload.exportAs = exportAs

    const res = await fetch(`${GAMMA_BASE}/generations`, {
      method: 'POST',
      headers: gammaHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Gamma API ${res.status}: ${errText}`)
    }

    const result = await res.json()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 502 },
    )
  }
}
