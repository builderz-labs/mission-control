import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import {
  getGatewayProxyManager,
  ALLOWED_GATEWAY_METHODS,
  OPERATOR_GATEWAY_METHODS,
} from '@/lib/gateway-proxy'
import { logger } from '@/lib/logger'
import { mutationLimiter, readLimiter, extractClientIp } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/db'

// Maximum accepted request body size (bytes) — prevents oversized gateway payloads.
const MAX_BODY_BYTES = 64 * 1024 // 64 KiB

/**
 * POST /api/gateway-proxy
 *
 * Calls a single gateway method on behalf of the browser when
 * GATEWAY_PROXY_MODE=1.  The server-side WebSocket connection to the
 * gateway is used; the browser never touches the gateway directly.
 *
 * Body:  { method: string; params?: unknown }
 * Returns: { result: unknown } | { error: string }
 *
 * Security:
 *  - Only enabled when GATEWAY_PROXY_MODE=1.
 *  - Caller must be authenticated (viewer+ for read-only methods,
 *    operator+ for mutating methods).
 *  - Method name is validated against ALLOWED_GATEWAY_METHODS allowlist.
 *  - Request body is limited to MAX_BODY_BYTES.
 *  - Mutating calls are rate-limited (mutationLimiter) and audit-logged.
 *  - Read-only calls are rate-limited (readLimiter).
 */
export async function POST(request: NextRequest) {
  if (!config.gatewayProxyMode) {
    return NextResponse.json({ error: 'Proxy mode not enabled' }, { status: 404 })
  }

  // All callers need at minimum viewer role
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Enforce request body size limit before parsing.
  // Check Content-Length header first (fast path) then verify actual body size
  // as a defence-in-depth measure — Content-Length can be absent or spoofed.
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
  }

  let body: { method?: unknown; params?: unknown }
  try {
    const raw = await request.text()
    // Defence-in-depth: re-check actual body length in case Content-Length was missing/wrong
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    }
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { method, params } = body

  if (!method || typeof method !== 'string') {
    return NextResponse.json({ error: 'method is required' }, { status: 400 })
  }

  if (!ALLOWED_GATEWAY_METHODS.has(method)) {
    return NextResponse.json(
      { error: `Method not allowed: ${method}` },
      { status: 403 },
    )
  }

  // Apply appropriate rate limit based on method type
  const isMutating = OPERATOR_GATEWAY_METHODS.has(method)
  const rateCheck = isMutating ? mutationLimiter(request) : readLimiter(request)
  if (rateCheck) return rateCheck

  // Mutating methods additionally require operator role
  if (isMutating) {
    const operatorAuth = requireRole(request, 'operator')
    if ('error' in operatorAuth) {
      return NextResponse.json(
        { error: operatorAuth.error },
        { status: operatorAuth.status },
      )
    }
  }

  // Audit log mutating gateway calls before execution so the attempt is recorded
  // even if the gateway call itself fails.
  if (isMutating) {
    try {
      logAuditEvent({
        action: `gateway_proxy.${method}`,
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'gateway',
        detail: { method, hasParams: params !== undefined },
        ip_address: extractClientIp(request),
        user_agent: request.headers.get('user-agent') ?? undefined,
      })
    } catch (auditErr) {
      logger.warn({ err: auditErr }, '[gateway-proxy] Audit log failed')
    }
  }

  try {
    const manager = getGatewayProxyManager()
    if (!manager.isConnected()) {
      // Trigger a (re)connect attempt but return a 503 so the caller can retry
      manager.connect()
      return NextResponse.json({ error: 'Gateway not connected' }, { status: 503 })
    }

    const result = await manager.callMethod(method, params)
    return NextResponse.json({ result })
  } catch (err: unknown) {
    logger.error({ err, method }, '[gateway-proxy] POST call failed')
    const message = err instanceof Error ? err.message : 'Gateway call failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
