// ---------------------------------------------------------------------------
// Network scanner — checks host allowlist, HSTS, secure cookies, gateway bind
// ---------------------------------------------------------------------------

import { config } from '@/lib/config'
import { type Category, type Check } from './types'
import { scoreCategory } from './report'

export function scanNetwork(): Category {
  const checks: Check[] = []

  const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim()
  const allowAny = process.env.MC_ALLOW_ANY_HOST
  const anyEnabled = allowAny === '1' || allowAny === 'true'
  checks.push({
    id: 'allowed_hosts',
    name: 'Host allowlist configured',
    status: anyEnabled ? 'fail' : allowedHosts ? 'pass' : 'warn',
    detail: anyEnabled
      ? 'MC_ALLOW_ANY_HOST is enabled — any host can connect'
      : allowedHosts
        ? `MC_ALLOWED_HOSTS: ${allowedHosts}`
        : 'MC_ALLOWED_HOSTS is not set',
    fix: allowAny
      ? 'Remove MC_ALLOW_ANY_HOST and set MC_ALLOWED_HOSTS instead'
      : !allowedHosts
        ? 'Set MC_ALLOWED_HOSTS=localhost,127.0.0.1 in .env'
        : '',
    severity: 'high' as const,
  })

  const hsts = process.env.MC_ENABLE_HSTS
  checks.push({
    id: 'hsts_enabled',
    name: 'HSTS enabled',
    status: hsts === '1' ? 'pass' : 'warn',
    detail: hsts === '1' ? 'Strict-Transport-Security header enabled' : 'HSTS is not enabled',
    fix: hsts !== '1' ? 'Set MC_ENABLE_HSTS=1 in .env (requires HTTPS)' : '',
    severity: 'medium' as const,
  })

  const cookieSecure = process.env.MC_COOKIE_SECURE
  const cookieOk = cookieSecure === '1' || cookieSecure === 'true'
  checks.push({
    id: 'cookie_secure',
    name: 'Secure cookies',
    status: cookieOk ? 'pass' : 'warn',
    detail: cookieOk ? 'Cookies marked secure' : 'Cookies not explicitly set to secure',
    fix: !cookieOk ? 'Set MC_COOKIE_SECURE=1 in .env (requires HTTPS)' : '',
    severity: 'medium' as const,
  })

  const gwHost = config.gatewayHost
  const gwLocal = gwHost === '127.0.0.1' || gwHost === 'localhost'
  checks.push({
    id: 'gateway_local',
    name: 'Gateway bound to localhost',
    status: gwLocal ? 'pass' : 'fail',
    detail: `Gateway host is ${gwHost}`,
    fix: !gwLocal ? 'Set OPENCLAW_GATEWAY_HOST=127.0.0.1 — never expose the gateway publicly' : '',
    severity: 'critical' as const,
  })

  return scoreCategory(checks)
}
