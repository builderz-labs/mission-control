import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { agents?: string[]; topic?: string; search?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { agents, topic, search = true } = body
  if (!agents || !Array.isArray(agents) || agents.length < 1)
    return NextResponse.json({ error: 'agents must be a non-empty array' }, { status: 400 })
  if (!topic || typeof topic !== 'string' || !topic.trim())
    return NextResponse.json({ error: 'topic is required' }, { status: 400 })

  const atlasUrl = config.atlas.dispatchUrl?.replace(/\/$/, '')
  const atlasKey = config.atlas.dispatchKey
  if (!atlasUrl || !atlasKey)
    return NextResponse.json({ error: 'Atlas not configured' }, { status: 503 })

  try {
    const resp = await fetch(`${atlasUrl}/council`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dispatch-Key': atlasKey },
      body: JSON.stringify({ agents, topic: topic.trim(), search, requested_by: 'gerda' }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      logger.error({ status: resp.status, data }, 'Atlas /council error')
      return NextResponse.json({ error: (data as { error?: string }).error || `Atlas error ${resp.status}` }, { status: resp.status >= 500 ? 502 : resp.status })
    }
    return NextResponse.json(data, { status: 202 })
  } catch (err) {
    logger.error({ err }, 'Council start failed')
    return NextResponse.json({ error: 'Failed to reach Atlas' }, { status: 502 })
  }
}
