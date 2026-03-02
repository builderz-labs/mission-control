import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const gatewaySessions = getAllGatewaySessions()

    // Deduplicate by sessionId (prefer most recent)
    const sessionMap = new Map<string, (typeof gatewaySessions)[0]>()
    for (const s of gatewaySessions) {
      const id = s.sessionId || `${s.agent}:${s.key}`
      const existing = sessionMap.get(id)
      if (!existing || s.updatedAt > existing.updatedAt) {
        sessionMap.set(id, s)
      }
    }

    const sessions = Array.from(sessionMap.values()).map((s) => {
      const total = s.totalTokens || 0
      const context = s.contextTokens || 35000
      const pct = context > 0 ? Math.round((total / context) * 100) : 0
      return {
        id: s.sessionId || `${s.agent}:${s.key}`,
        key: s.key,
        agent: s.agent,
        kind: s.chatType || 'unknown',
        age: formatAge(s.updatedAt),
        model: s.model,
        tokens: `${formatTokens(total)}/${formatTokens(context)} (${pct}%)`,
        channel: s.channel,
        flags: [],
        active: s.active,
        startTime: s.updatedAt,
        lastActivity: s.updatedAt,
      }
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    logger.error({ err: error }, 'Sessions API error')
    return NextResponse.json({ sessions: [] })
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export const dynamic = 'force-dynamic'
