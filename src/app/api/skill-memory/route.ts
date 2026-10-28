import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSkillMemoryHealth, getSkillMemoryPolicy } from '@/lib/skill-memory/adapter'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({
    health: getSkillMemoryHealth(),
    policy: getSkillMemoryPolicy(),
  })
}
