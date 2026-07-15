import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('gateway configuration client contracts', () => {
  it('uses the shared client and never applies after a failed prerequisite save', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/gateway-config-panel.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/fetch\(['"]\/api\/gateway-config/)
    expect(source).toContain("apiFetch<GatewayConfigResponse>('/api/gateway-config')")
    expect(source).toContain('if (hasChanges && !(await handleSave())) return')
  })
})
