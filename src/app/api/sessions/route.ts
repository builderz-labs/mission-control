import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function GET() {
  try {
    const { stdout } = await execAsync('openclaw sessions --json', { timeout: 5000 })
    const data = JSON.parse(stdout)
    
    const sessions = (data.sessions || []).map((s: any, i: number) => ({
      id: s.key || `session-${i}`,
      key: s.key || '',
      kind: s.kind || 'unknown',
      age: formatAge(s.updatedAt),
      model: s.model || '',
      tokens: `${s.totalTokens || 0}/${s.contextTokens || 35000}`,
      flags: [],
      active: isActive(s.updatedAt),
      startTime: s.updatedAt,
      lastActivity: s.updatedAt
    }))
    
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Sessions API error:', error)
    return NextResponse.json({ sessions: [] })
  }
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

function isActive(timestamp: number): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp < 60 * 60 * 1000 // Active within 1 hour
}

export const dynamic = 'force-dynamic' // Ensure fresh data on each request