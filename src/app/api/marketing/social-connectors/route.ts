import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { socialConnectorRegistry } from '@/lib/marketing/social-connectors'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    connectors: socialConnectorRegistry,
    policy: {
      preferred: ['official_api', 'official_export', 'first_party_analytics'],
      scraping_default: 'disabled',
      credentials_configured: false,
      auto_posting: false,
    },
  })
}
