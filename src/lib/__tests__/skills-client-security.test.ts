import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Skills client security contract', () => {
  it('routes all extension-management requests through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/skills-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(9)
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/skills/)
    expect(source).toContain('function skillApiPayload<T>')
    expect(source).toContain('function skillApiMessage')
    expect(source).toContain("apiFetch<RegistryInstallResponse>('/api/skills/registry'")
    expect(source).toContain('securityStatus: body?.securityReport?.status')
    expect(source.match(/apiFetch<SkillContentResponse>/g)).toHaveLength(3)
    expect(source).toContain('state.results.error++')
  })
})
