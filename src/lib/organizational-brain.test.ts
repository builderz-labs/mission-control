import { describe, expect, it } from 'vitest'
import { BRAIN_ROUTES, ORGANIZATIONAL_BRAIN_ENTRY, getOrganizationalBrainStatus } from './organizational-brain'

describe('organizational brain bridge', () => {
  it('uses AGENT_BRAIN as the canonical shared entry point', async () => {
    expect(ORGANIZATIONAL_BRAIN_ENTRY).toBe('AGENT_BRAIN.md')
    expect(BRAIN_ROUTES.productbaton).toContain('LaunchLot')
    expect(BRAIN_ROUTES.company_os).toContain('AI Company OS')
    const status = await getOrganizationalBrainStatus()
    expect(typeof status.connected).toBe('boolean')
    expect(status.routes).toEqual(BRAIN_ROUTES)
  })
})
