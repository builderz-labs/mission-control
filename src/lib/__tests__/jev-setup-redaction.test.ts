import { describe, expect, it } from 'vitest'
import {
  redactJevSetupText,
  serializeRedactedJevSetupValue,
} from '@/lib/jev-setup-redaction'

describe('Jev setup persistence redaction', () => {
  it('removes a complete PEM block before generic secret scanning', () => {
    const boundary = (kind: 'BEGIN' | 'END') => `-----${kind} PRIVATE KEY-----`
    const pem = [
      'before',
      boundary('BEGIN'),
      'c3VwZXItc2VjcmV0LWtleS1ib2R5',
      boundary('END'),
      'after',
    ].join('\n')
    const redacted = redactJevSetupText(pem)
    expect(redacted).toContain('[redacted-private-key]')
    expect(redacted).not.toContain('c3VwZXItc2VjcmV0LWtleS1ib2R5')
  })

  it('redacts quoted JSON secrets embedded in strings', () => {
    const redacted = redactJevSetupText('{"password":"hunter2","safe":"value"}')
    expect(redacted).toContain('"password":"[redacted]"')
    expect(redacted).not.toContain('hunter2')
  })

  it('redacts sensitive object keys at every recursive depth', () => {
    const serialized = serializeRedactedJevSetupValue({
      safe: 'visible',
      nested: {
        password: 'hunter2',
        accessToken: 'opaque-value',
        key: 'generic-key-value',
        credentials: { client: 'do-not-keep' },
      },
    })
    expect(serialized).toContain('visible')
    expect(serialized).not.toMatch(/hunter2|opaque-value|generic-key-value|do-not-keep/)
    expect(JSON.parse(serialized)).toMatchObject({
      nested: {
        password: '[redacted]',
        accessToken: '[redacted]',
        key: '[redacted]',
        credentials: '[redacted]',
      },
    })
  })
})
