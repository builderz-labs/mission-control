import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMissionControlCsp, buildNonceRequestHeaders } from '@/lib/csp'

const ROOT = resolve(__dirname, '../../..')

describe('buildMissionControlCsp', () => {
  it('includes the request nonce in script and style directives', () => {
    const csp = buildMissionControlCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic'`)
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'")
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
    expect(headers.get('Content-Security-Policy')).toContain("style-src 'self' 'unsafe-inline'")
  })
})

describe('root layout CSP nonce wiring', () => {
  const layoutSource = readFileSync(resolve(ROOT, 'src/app/layout.tsx'), 'utf-8')

  it('passes the request nonce to next-themes ThemeProvider', () => {
    expect(layoutSource).toContain('<ThemeProvider')
    expect(layoutSource).toContain('nonce={nonce}')
  })
})
