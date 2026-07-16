import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Integrations client security contract', () => {
  it('routes every credential request through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/integrations-panel.tsx'),
      'utf8',
    )

    expect(source).toContain("apiFetch<IntegrationsResponse>('/api/integrations')")
    expect(source.match(/apiFetch<IntegrationMutationResult>\('\/api\/integrations'/g)).toHaveLength(4)
    expect(source).toContain(
      '`/api/integrations?keys=${encodeURIComponent(envKeys.join(\',\'))}`',
    )
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/integrations/)

    expect(source).toContain('function integrationErrorData')
    expect(source).toContain('error instanceof ApiError')
    expect(source).toContain('return error.payload as IntegrationMutationResult')
    expect(source).toContain("err.status === 401 || err.status === 403")
    expect(source).toContain("'Admin access required'")
    expect(source.match(/integrationErrorData\(err\)/g)).toHaveLength(5)
  })
})
