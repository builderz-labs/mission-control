import { getErrorMessage, toError } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { createTenantAndBootstrapJob, listTenants } from '@/lib/super-admin'
import { logger } from '@/lib/logger'

/**
 * GET /api/super/tenants - List tenants and latest provisioning status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ tenants: listTenants() })
}

/**
 * POST /api/super/tenants - Create tenant and queue bootstrap job
 * SECURITY: Validates input schema before forwarding to bootstrap (CRITICAL-6 fix)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()

    // SECURITY: Strict input validation — only allow known fields (CRITICAL-6 fix)
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
    const linuxUser = typeof body.linux_user === 'string' ? body.linux_user.trim().toLowerCase() : slug

    if (!slug || !/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(slug)) {
      return NextResponse.json({ error: 'Invalid slug. Use lowercase letters, numbers, dashes, underscores (3-32 chars).' }, { status: 400 })
    }
    if (!displayName || displayName.length > 100) {
      return NextResponse.json({ error: 'display_name is required (max 100 chars).' }, { status: 400 })
    }
    if (linuxUser && !/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(linuxUser)) {
      return NextResponse.json({ error: 'Invalid linux_user format.' }, { status: 400 })
    }

    const sanitizedBody = {
      slug,
      display_name: displayName,
      linux_user: linuxUser,
      gateway_port: typeof body.gateway_port === 'number' ? body.gateway_port : undefined,
      owner_gateway: typeof body.owner_gateway === 'string' ? body.owner_gateway : undefined,
      dry_run: body.dry_run !== false,
      config: typeof body.config === 'object' && body.config !== null ? {
        install_openclaw: !!body.config.install_openclaw,
        install_claude: !!body.config.install_claude,
        install_codex: !!body.config.install_codex,
      } : undefined,
    }

    const created = createTenantAndBootstrapJob(sanitizedBody, auth.user.username)
    return NextResponse.json(created, { status: 201 })
  } catch (error: unknown) {
    if (String(getErrorMessage(error) || '').includes('UNIQUE')) {
      return NextResponse.json({ error: 'Tenant slug or linux user already exists' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/super/tenants error')
    return NextResponse.json({ error: 'Failed to create tenant bootstrap job. Check server logs.' }, { status: 400 })
  }
}
