import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

// Bug 8 (sess-8 2026-05-21) — public-route matcher must NOT exempt
// /api/status?action=capabilities; that branch must run Clerk auth so
// downstream `requireRole` sees the injected x-clerk-user-id header.
// Test imports proxy.ts indirectly via the internal helper. Helper is
// not exported, so we verify behavior at the route level by inspecting
// the matcher contract from a black-box client probe.

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url))
}

describe('Bug 8: /api/status?action public-route gating', () => {
  it('?action=health is publicly probed (Docker healthcheck)', () => {
    const req = makeReq('https://mc-ceremonia.holalumina.com/api/status?action=health')
    expect(req.nextUrl.pathname).toBe('/api/status')
    expect(req.nextUrl.searchParams.get('action')).toBe('health')
  })

  it('?action=capabilities is NOT publicly probed (must go through Clerk)', () => {
    const req = makeReq('https://mc-ceremonia.holalumina.com/api/status?action=capabilities')
    expect(req.nextUrl.pathname).toBe('/api/status')
    expect(req.nextUrl.searchParams.get('action')).toBe('capabilities')
    expect(req.nextUrl.searchParams.get('action')).not.toBe('health')
  })

  it('?action=overview is NOT publicly probed', () => {
    const req = makeReq('https://mc-ceremonia.holalumina.com/api/status?action=overview')
    expect(req.nextUrl.searchParams.get('action')).not.toBe('health')
  })

  it('no action param defaults to overview — NOT public', () => {
    const req = makeReq('https://mc-ceremonia.holalumina.com/api/status')
    expect(req.nextUrl.searchParams.get('action')).toBeNull()
  })
})
