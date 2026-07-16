import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Agent Comms client security contract', () => {
  it('uses the shared client without dropping operator and injection feedback', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/agent-comms-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(4)
    expect(source).not.toMatch(/fetch\(['"`]\/api\//)
    expect(source).toContain('err.status === 422')
    expect(source).toContain('payload?.injection?.length')
    expect(source).toContain('err.status === 403')
    expect(source).toContain('You need operator access to send messages')
  })
})
