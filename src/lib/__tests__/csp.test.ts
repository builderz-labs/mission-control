import { describe, expect, it } from 'vitest'
import { buildMissionControlCsp, buildNonceRequestHeaders } from '@/lib/csp'

describe('buildMissionControlCsp', () => {
  it('includes the request nonce in script and style directives', () => {
    const csp = buildMissionControlCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic'`)
    // style-src uses nonce-based allowlisting — unsafe-inline intentionally absent
    expect(csp).toContain("style-src 'self' 'nonce-nonce-123'")
    expect(csp).toContain("style-src-elem 'self' 'nonce-nonce-123'")
    // style-src-attr cannot use nonces (element attributes), so unsafe-inline is required
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
  })
})

describe('buildNonceRequestHeaders', () => {
  it('propagates nonce and CSP into request headers for Next.js rendering', () => {
    const headers = buildNonceRequestHeaders({
      headers: new Headers({ host: 'localhost:3000' }),
      nonce: 'nonce-123',
      googleEnabled: false,
    })

    expect(headers.get('x-nonce')).toBe('nonce-123')
    expect(headers.get('Content-Security-Policy')).toContain("style-src 'self' 'nonce-nonce-123'")
  })
})
