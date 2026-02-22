import { NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'

export async function GET() {
  try {
    const gatewaySessions = getAllGatewaySessions()

    const sessions = gatewaySessions.map((s) => {
      const total = s.totalTokens || 0
      const context = s.contextTokens || 35000
      const pct = context > 0 ? Math.round((total / context) * 100) : 0
      return {
        id: s.sessionId || s.key,
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
    console.error('Sessions API error:', error)
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
