import { NextResponse } from 'next/server'
import { createSession, getAllUsers } from '@/lib/auth'
import { logAuditEvent, needsFirstTimeSetup } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { findExposedAddresses, nonLoopbackAddresses } from '@/lib/auto-login-probe'
import {
  isAllowedAutoLoginNavigation,
  isAutoLoginEnabled,
  isLoopbackHostHeader,
  portFromUrl,
  safeAutoLoginTarget,
} from '@/lib/auto-login'
import { consumeAutoLoginToken } from '@/lib/auto-login-token'

export const dynamic = 'force-dynamic'

/**
 * Every check has to pass; a single unknown is a denial. The reachability probe
 * is the part that does not trust configuration: if this app's own port answers
 * on a non-loopback interface, the machine is exposed and auto-login is off.
 */
async function getAutoLoginDenial(request: Request): Promise<string | null> {
  if (!isAutoLoginEnabled()) return 'disabled'
  if (!isAllowedAutoLoginNavigation(request.headers.get('sec-fetch-site'))) return 'unsafe navigation'
  if (!isLoopbackHostHeader(request.headers.get('host'))) return 'non-loopback host'
  const port = portFromUrl(request.url)
  if (!port) return 'unknown port'
  const exposed = await findExposedAddresses(port, { addresses: nonLoopbackAddresses() })
  if (exposed.length > 0) return `port ${port} reachable on ${exposed.join(', ')}`
  return null
}

function eligibleAutoLoginUser(): ReturnType<typeof getAllUsers>[number] | null {
  const username = String(process.env.AUTH_USER || 'admin').trim().toLowerCase()
  const user = getAllUsers().find((candidate) => candidate.username === username)
  if (!user) return null
  if ((user.provider || 'local') !== 'local') return null
  if ((user.is_approved ?? 1) !== 1) return null
  return user
}

function autoLoginRedirect(request: Request, targetPath: string): NextResponse {
  const response = NextResponse.redirect(new URL(targetPath, request.url))
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const deny = await getAutoLoginDenial(request)
  if (deny) {
    logger.warn({ reason: deny }, 'Auto-login denied')
    return autoLoginRedirect(request, '/login')
  }

  if (!consumeAutoLoginToken(url.searchParams.get('t'))) {
    logger.warn({ reason: 'invalid or expired token' }, 'Auto-login denied')
    return autoLoginRedirect(request, '/login')
  }

  const user = eligibleAutoLoginUser()
  if (!user) {
    return autoLoginRedirect(request, needsFirstTimeSetup() ? '/setup' : '/login')
  }

  const userAgent = request.headers.get('user-agent') || undefined
  const { token, expiresAt } = createSession(user.id, '127.0.0.1', userAgent, user.workspace_id)
  logAuditEvent({ action: 'auto_login', actor: user.username, actor_id: user.id, ip_address: '127.0.0.1', user_agent: userAgent })

  const isSecureRequest = isRequestSecure(request)
  const response = autoLoginRedirect(request, safeAutoLoginTarget(url.searchParams.get('next')))
  response.cookies.set(getMcSessionCookieName(isSecureRequest), token, {
    ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
  })
  return response
}
