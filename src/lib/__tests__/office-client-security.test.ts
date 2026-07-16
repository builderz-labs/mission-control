import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Office client security contract', () => {
  it('secures all office API paths and preserves partial polling and safe fallbacks', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/office-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(3)
    expect(source).not.toMatch(/fetch\([`'"]\/api\//)
    expect(source).toContain("apiFetch<{ agents?: Agent[] }>('/api/agents').catch(() => null)")
    expect(source).toContain(
      "apiFetch<{ sessions?: SessionAgentRow[] }>('/api/sessions').catch(() => null)",
    )
    expect(source).toContain(
      "apiFetch<FlightDeckResponse>('/api/local/flight-deck'",
    )
    expect(source).toContain('err instanceof ApiError')
    expect(source).toContain('payload?.installed === false')
    expect(source).toContain('getSafeHttpUrl(payload?.fallbackUrl)')
    expect(source).toContain("url.protocol === 'http:' || url.protocol === 'https:'")
    expect(source).toContain("window.open(fallbackUrl, '_blank', 'noopener,noreferrer')")
    expect(source).not.toContain('if (!res.ok || json?.installed === false)')
  })
})
