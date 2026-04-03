import { NextRequest, NextResponse } from 'next/server'
import { apiGuard } from '@/lib/api-guard'
import { getJarvisBaseUrl, isJarvisEnabled } from '@/lib/jarvis/config'

export const GET = apiGuard({ role: 'viewer', rateLimit: 'read' }, async (_request: NextRequest) => {
  if (!isJarvisEnabled()) {
    return NextResponse.json({ status: 'disabled' })
  }

  try {
    const res = await fetch(`${getJarvisBaseUrl()}/api/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return NextResponse.json(
        { status: 'error', detail: `JARVIS returned ${res.status}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    return NextResponse.json({ status: 'ok', ...data })
  } catch {
    return NextResponse.json(
      { status: 'unreachable', detail: 'JARVIS backend not running' },
      { status: 503 }
    )
  }
})
