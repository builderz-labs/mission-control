import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { error: 'Not implemented', message: 'Progress tracking is not yet available' },
    { status: 501 }
  )
}

export const dynamic = 'force-dynamic'
