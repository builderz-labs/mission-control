import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const atlasUrl = config.atlas.dispatchUrl?.replace(/\/$/, '')
  const atlasKey = config.atlas.dispatchKey
  if (!atlasUrl || !atlasKey) return NextResponse.json({ error: 'Atlas not configured' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get('id')
  const endpoint = roomId ? `${atlasUrl}/rooms/${roomId}` : `${atlasUrl}/rooms`

  try {
    const resp = await fetch(endpoint, { method: 'GET', headers: { 'X-Dispatch-Key': atlasKey }, cache: 'no-store' })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      logger.error({ status: resp.status, data }, 'Atlas /rooms error')
      return NextResponse.json({ error: (data as { error?: string }).error || `Atlas error ${resp.status}` }, { status: resp.status >= 500 ? 502 : resp.status })
    }
    return NextResponse.json(data)
  } catch (err) {
    logger.error({ err }, 'Council rooms fetch failed')
    return NextResponse.json({ error: 'Failed to reach Atlas' }, { status: 502 })
  }
}
