// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('../../../next.config.js') as {
  serverExternalPackages?: string[]
}

describe('standalone WebSocket packaging', () => {
  it('loads ws from the traced runtime package', () => {
    expect(config.serverExternalPackages).toContain('ws')
  })
})
