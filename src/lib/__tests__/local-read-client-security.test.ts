import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Local read client security contract', () => {
  it('routes host-scoped reads through the shared API client with lifecycle guards', () => {
    const systemMonitor = readFileSync(
      join(process.cwd(), 'src/components/panels/system-monitor-panel.tsx'),
      'utf8',
    )
    const agentsDoc = readFileSync(
      join(process.cwd(), 'src/components/panels/local-agents-doc-panel.tsx'),
      'utf8',
    )

    expect(systemMonitor.match(/apiFetch</g)).toHaveLength(1)
    expect(systemMonitor).not.toMatch(/fetch\([`'"]\/api\/system-monitor/)
    expect(systemMonitor).toContain("apiFetch<Snapshot>('/api/system-monitor'")
    expect(systemMonitor).toContain('signal: controller.signal')
    expect(systemMonitor).toContain('if (!controller.signal.aborted)')

    expect(agentsDoc.match(/apiFetch</g)).toHaveLength(1)
    expect(agentsDoc).not.toMatch(/fetch\([`'"]\/api\/local\/agents-doc/)
    expect(agentsDoc).toContain(
      "apiFetch<AgentsDocResponse>('/api/local/agents-doc'",
    )
    expect(agentsDoc).toContain("cache: 'no-store'")
    expect(agentsDoc).toContain('if (!cancelled) setData(body)')
    expect(agentsDoc).toContain('if (!cancelled) {')
  })
})
