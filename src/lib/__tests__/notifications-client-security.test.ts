import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Notifications client security contract', () => {
  it('routes notification reads and operator mutations through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/notifications-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch</g)).toHaveLength(3)
    expect(source).not.toMatch(/fetch\([`'"]\/api\/notifications/)
    expect(source).toContain(
      '`/api/notifications?recipient=${encodeURIComponent(recipient)}`',
    )
    expect(source.match(/method: 'PUT'/g)).toHaveLength(2)
    expect(source).toContain('JSON.stringify({ recipient, markAllRead: true })')
    expect(source).toContain('JSON.stringify({ ids: [id] })')
    expect(source.match(/Silent — notification state will resync on next poll/g)).toHaveLength(2)
  })
})
