import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Channels client security contract', () => {
  it('uses the shared client without weakening channel error handling', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/channels-panel.tsx'),
      'utf8',
    )

    expect(source).toContain("apiFetch<ChannelsSnapshot>('/api/channels')")
    expect(source).toContain(
      'apiFetch(`/api/channels?action=probe&channel=${encodeURIComponent(channelId)}`)',
    )
    expect(source).toContain("apiFetch<ActionResult>('/api/channels'")
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/channels/)

    expect(source).toContain("err.status === 401 || err.status === 403")
    expect(source).toContain("'Authentication required'")
    expect(source).toContain('err.payload !== undefined')
    expect(source).toContain('return err.payload')
    expect(source.match(/await fetchChannels\(\)/g)).toHaveLength(3)
  })
})
