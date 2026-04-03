import { NextRequest, NextResponse } from 'next/server'
import { apiGuard } from '@/lib/api-guard'
import { getJarvisBaseUrl, isJarvisEnabled } from '@/lib/jarvis/config'

export const POST = apiGuard({ role: 'viewer', rateLimit: 'mutation' }, async (request: NextRequest, auth) => {
  if (!isJarvisEnabled()) {
    return NextResponse.json({ error: 'JARVIS is disabled' }, { status: 503 })
  }

  try {
    const body = await request.json()
    const transcript: string | undefined = body.transcript

    if (!transcript?.trim()) {
      return NextResponse.json(
        { error: 'Missing transcript in request body' },
        { status: 400 }
      )
    }

    if (transcript.length > 2000) {
      return NextResponse.json({ error: 'Transcript too long' }, { status: 413 })
    }

    // Forward the voice command to JARVIS backend via WebSocket-like REST call
    const res = await fetch(`${getJarvisBaseUrl()}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript, user: auth.user.username }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => 'Unknown error')
      return NextResponse.json(
        { error: 'JARVIS command failed', detail },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Failed to reach JARVIS backend' },
      { status: 502 }
    )
  }
})
