import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Navigation and activity client security contract', () => {
  it('routes targeted internal requests through the shared API client', () => {
    const navSource = readFileSync(
      join(process.cwd(), 'src/components/layout/nav-rail.tsx'),
      'utf8',
    )
    const activitySource = readFileSync(
      join(process.cwd(), 'src/components/panels/activity-feed-panel.tsx'),
      'utf8',
    )

    expect(navSource.match(/apiFetch\('\/api\/settings'/g)).toHaveLength(2)
    expect(navSource).toContain("apiFetch('/api/auth/logout', { method: 'POST' })")
    expect(navSource).not.toMatch(/fetch\(['"]\/api\/(?:settings|auth\/logout)/)
    expect(navSource).toContain("} catch {}\n                  router.push('/login')")

    expect(activitySource).toContain(
      "apiFetch<{ sessions?: SessionInfo[] }>('/api/sessions')",
    )
    expect(activitySource).not.toMatch(/fetch\(['"]\/api\/sessions/)
    expect(activitySource).toContain('/* silent */')
  })
})
