import { describe, expect, it } from 'vitest'
import { filesTouched, redactSecrets } from '../handoff-redact'

describe('redactSecrets', () => {
  it('strips tokens and api keys', () => {
    expect(redactSecrets('token ghp_abcdefghijk and Bearer xyz')).toContain('[redacted]')
    expect(redactSecrets('sk-live-secret-token-value')).toBe('[redacted]')
  })
})

describe('filesTouched', () => {
  it('collects unique source paths', () => {
    expect(filesTouched('edited src/lib/foo.ts and src/lib/foo.ts then README.md')).toEqual([
      'src/lib/foo.ts',
      'README.md',
    ])
  })
})
