/**
 * Bug 11b regression — chat-workspace.tsx:597 POST /api/chat/messages must
 * route through fetchWithClerkRetry, NOT bare fetch.
 *
 * Sess-10 (PR #11) shipped fetchWithClerkRetry for /api/agents + /api/agents/sync
 * + /api/settings. Sess-11 confirmed POST /api/chat/messages also hits the same
 * Clerk satellite handshake race intermittently. Sess-12 wires the helper into
 * chat-workspace's gateway-session send path.
 *
 * Unit-mocking the full component is heavy (zustand store + WS + smart-poll +
 * conversation list). Source-level regression catches the contract change at
 * negligible cost: if a future refactor reintroduces bare fetch on this POST,
 * this test fails and points at chat-workspace.tsx.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_WORKSPACE = join(
  __dirname,
  '..',
  '..',
  'components',
  'chat',
  'chat-workspace.tsx',
)

describe('chat-workspace.tsx /api/chat/messages POST', () => {
  const source = readFileSync(CHAT_WORKSPACE, 'utf8')

  it('imports fetchWithClerkRetry helper', () => {
    expect(source).toMatch(
      /import\s*\{\s*fetchWithClerkRetry\s*\}\s*from\s*['"]@\/lib\/auth\/fetch-with-clerk-retry['"]/,
    )
  })

  it('routes the gateway-session POST through fetchWithClerkRetry', () => {
    expect(source).toMatch(
      /fetchWithClerkRetry\(\s*['"]\/api\/chat\/messages['"]/,
    )
  })

  it('does not use bare fetch() on /api/chat/messages', () => {
    // A bare `fetch('/api/chat/messages', ...)` would reintroduce the Bug 11b
    // race. `fetchWithClerkRetry` is a different identifier so this passes.
    const bareFetchHit = /\bfetch\(\s*['"]\/api\/chat\/messages['"]/.test(source)
    expect(bareFetchHit).toBe(false)
  })

  it('passes loginFallbackPath for legacy /login fallback', () => {
    expect(source).toMatch(/loginFallbackPath:\s*['"]\/login\?next=%2Fchat['"]/)
  })
})
