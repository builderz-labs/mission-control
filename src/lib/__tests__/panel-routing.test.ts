import { describe, expect, it } from 'vitest'
import { canonicalPanelId, panelPath } from '../panel-routing'

describe('panel routing', () => {
  it.each([
    ['sessions', 'chat'],
    ['tokens', 'cost-tracker'],
    ['agent-costs', 'cost-tracker'],
    ['history', 'activity'],
    ['gateway-parent', 'gateways'],
  ])('canonicalizes %s to %s', (alias, canonical) => {
    expect(canonicalPanelId(alias)).toBe(canonical)
    expect(panelPath(alias)).toBe(`/${canonical}`)
  })

  it('normalizes overview and ordinary panel paths', () => {
    expect(panelPath('/')).toBe('/')
    expect(panelPath('overview')).toBe('/')
    expect(panelPath('/agents/')).toBe('/agents')
  })
})

