import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCrmContacts } from '@/lib/crm'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(request.url)
  const type = url.searchParams.get('type') || undefined
  const warmth = url.searchParams.get('warmth') || undefined
  const search = url.searchParams.get('search') || undefined
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const result = getCrmContacts({ type, warmth, search, limit, offset })
  return NextResponse.json(result)
}
