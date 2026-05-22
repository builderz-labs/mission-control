/**
 * Clerk webhook route — Phase 3 BUILD D3.
 *
 * Receives Clerk webhook events (Svix-signed) for session revocation:
 *   - `user.deleted`     → destroy all MC sessions for that user
 *   - `session.revoked`  → destroy all MC sessions for that user
 *
 * Maps Clerk `user_id` → MC `users.id` via `users.clerk_user_id`
 * (migration 100_clerk_bridge). When no MC row matches, the call is a
 * no-op — Clerk webhook delivery is at-least-once and the user may have
 * never logged into this MC instance.
 *
 * Public route — bypasses middleware auth via `createRouteMatcher` in
 * `src/middleware.ts:isPublicRoute`. Authentication is via Svix HMAC.
 *
 * Cutover runbook: docs/phase-3-clerk-cutover-runbook.md
 */

import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { getDatabase } from '@/lib/db'
import { destroyAllUserSessions } from '@/lib/auth'
import { logSecurityEvent } from '@/lib/security-events'

interface ClerkUserDeletedEvent {
  type: 'user.deleted'
  data: { id: string }
}

interface ClerkSessionRevokedEvent {
  type: 'session.revoked' | 'session.ended' | 'session.removed'
  data: { id: string; user_id: string }
}

type ClerkWebhookEvent = ClerkUserDeletedEvent | ClerkSessionRevokedEvent | { type: string; data: unknown }

function resolveMcUserId(clerkUserId: string): number | null {
  try {
    const db = getDatabase()
    const row = db
      .prepare('SELECT id FROM users WHERE clerk_user_id = ? LIMIT 1')
      .get(clerkUserId) as { id?: number } | undefined
    return row?.id ?? null
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  const signingSecret = (process.env.CLERK_WEBHOOK_SIGNING_SECRET || '').trim()
  if (!signingSecret) {
    // Disabled — Phase 3 pre-cutover tenant. Return 503 so Clerk retries
    // when the env eventually lands rather than discarding the event.
    return NextResponse.json({ error: 'webhook disabled — CLERK_WEBHOOK_SIGNING_SECRET unset' }, { status: 503 })
  }

  const svixId = request.headers.get('svix-id') || ''
  const svixTimestamp = request.headers.get('svix-timestamp') || ''
  const svixSignature = request.headers.get('svix-signature') || ''
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 })
  }

  // Svix verifies against the raw body — we must NOT JSON.parse before verify.
  const rawBody = await request.text()

  let evt: ClerkWebhookEvent
  try {
    const wh = new Webhook(signingSecret)
    evt = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent
  } catch (err) {
    try {
      logSecurityEvent({
        event_type: 'clerk_webhook_invalid_signature',
        severity: 'warning',
        source: 'auth',
        detail: JSON.stringify({ svixId, reason: err instanceof Error ? err.message : 'unknown' }),
        workspace_id: 1,
        tenant_id: 1,
      })
    } catch {}
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // Handle revocation events. All other event types are no-ops (Clerk
  // sends many event types; we intentionally only listen for the two
  // session-impacting ones to keep the surface minimal).
  let clerkUserId: string | null = null
  if (evt.type === 'user.deleted') {
    clerkUserId = (evt.data as { id?: string }).id ?? null
  } else if (
    evt.type === 'session.revoked' ||
    evt.type === 'session.ended' ||
    evt.type === 'session.removed'
  ) {
    clerkUserId = (evt.data as { user_id?: string }).user_id ?? null
  }

  if (!clerkUserId) {
    return NextResponse.json({ ok: true, handled: false, eventType: evt.type })
  }

  const mcUserId = resolveMcUserId(clerkUserId)
  if (mcUserId == null) {
    // No matching MC user — Clerk user never logged into this instance.
    // Still return 200 so Clerk doesn't retry.
    return NextResponse.json({ ok: true, handled: false, reason: 'no-mc-user', eventType: evt.type })
  }

  try {
    destroyAllUserSessions(mcUserId)
  } catch (err) {
    try {
      logSecurityEvent({
        event_type: 'clerk_webhook_session_destroy_failed',
        severity: 'critical',
        source: 'auth',
        detail: JSON.stringify({ clerkUserId, mcUserId, reason: err instanceof Error ? err.message : 'unknown' }),
        workspace_id: 1,
        tenant_id: 1,
      })
    } catch {}
    return NextResponse.json({ error: 'session destroy failed' }, { status: 500 })
  }

  try {
    logSecurityEvent({
      event_type: 'clerk_webhook_sessions_destroyed',
      severity: 'info',
      source: 'auth',
      detail: JSON.stringify({ clerkUserId, mcUserId, eventType: evt.type }),
      workspace_id: 1,
      tenant_id: 1,
    })
  } catch {}

  return NextResponse.json({ ok: true, handled: true, eventType: evt.type, mcUserId })
}
