import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrganizationalBrainStatus, readOrganizationalBrainEntry } from '@/lib/organizational-brain'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const includeContent = url.searchParams.get('include_content') === '1'

  try {
    const payload = includeContent
      ? await readOrganizationalBrainEntry()
      : await getOrganizationalBrainStatus()
    return NextResponse.json(payload)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Organizational Brain unavailable' },
      { status: 500 },
    )
  }
}
