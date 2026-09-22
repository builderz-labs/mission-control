import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function parseNpmVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10))
  if (![major, minor, patch].every(Number.isFinite)) {
    throw new Error(`unparseable version: ${version}`)
  }
  return [major, minor, patch]
}

describe('Next.js advisory floor', () => {
  it('is at least 16.3.3 (GHSA-2xp9-vwfh-vxw4 / GHSA-p293-qw3h-jr36)', () => {
    const { version } = require('next/package.json') as { version: string }
    const [major, minor, patch] = parseNpmVersion(version)
    const patched = major > 16 || (major === 16 && (minor > 3 || (minor === 3 && patch >= 3)))
    expect(patched, `next@${version} is below the 16.3.3 RCE floor`).toBe(true)
  })
})
