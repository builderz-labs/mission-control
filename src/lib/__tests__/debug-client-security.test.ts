import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Debug client security contract', () => {
  it('uses the shared client and preserves diagnostic error payloads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/debug-panel.tsx'),
      'utf8',
    )

    for (const action of ['status', 'health', 'heartbeat', 'models', 'call']) {
      expect(source).toContain(`/api/debug?action=${action}`)
    }
    expect(source.match(/apiFetch</g)).toHaveLength(5)
    expect(source).not.toMatch(/fetch\(['"]\/api\/debug/)

    expect(source).toContain('function diagnosticPayload<T>')
    expect(source).toContain('error instanceof ApiError')
    expect(source).toContain('error.payload !== undefined')
    expect(source).toContain('return error.payload as T')
    expect(source.match(/diagnosticPayload\(err,/g)).toHaveLength(5)
  })
})
