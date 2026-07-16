import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  MAX_BASE_URL_LENGTH,
  normalizeMissionControlBaseUrl,
} = require('../../../scripts/mc-base-url.cjs') as {
  MAX_BASE_URL_LENGTH: number
  normalizeMissionControlBaseUrl: (value: unknown) => string
}

describe('Mission Control CLI base URL validation', () => {
  it.each([
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['https://control.example.com/', 'https://control.example.com'],
    ['https://control.example.com/base/', 'https://control.example.com/base'],
  ])('normalizes an HTTP(S) destination: %s', (input, expected) => {
    expect(normalizeMissionControlBaseUrl(input)).toBe(expected)
  })

  it.each([
    'file:///tmp/socket',
    'data:text/plain,hello',
    'ftp://control.example.com',
    'https://user:secret@control.example.com',
    'https://control.example.com?next=https://evil.example',
    'https://control.example.com/#fragment',
    'https://control.example.com/\nmalformed',
    'not-a-url',
    '',
  ])('rejects an unsafe destination: %s', (input) => {
    expect(() => normalizeMissionControlBaseUrl(input)).toThrow()
  })

  it('rejects excessively long profile values', () => {
    expect(() => normalizeMissionControlBaseUrl(
      `https://control.example.com/${'a'.repeat(MAX_BASE_URL_LENGTH)}`,
    )).toThrow('Mission Control URL is invalid')
  })
})
