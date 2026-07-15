import { describe, expect, it } from 'vitest'
import { normalizeReleaseTag } from '@/lib/release-update-security'

describe('release update target validation', () => {
  it.each([
    ['2.1.0', 'v2.1.0'],
    ['v2.1.0', 'v2.1.0'],
    ['2.1.0-rc.1', 'v2.1.0-rc.1'],
    ['2.1.0+build.7', 'v2.1.0+build.7'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeReleaseTag(input)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    '',
    'latest',
    'v1',
    '01.2.3',
    '1.2.3/../../main',
    '--help',
    '1.2.3\nmain',
  ])('rejects unsafe or non-semver target %j', (input) => {
    expect(normalizeReleaseTag(input)).toBeNull()
  })
})
