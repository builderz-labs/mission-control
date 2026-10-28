import { describe, expect, it } from 'vitest'
import { listFactoryAdapters, listFactoryDefinitions } from './registry'

describe('factory registry', () => {
  it('exposes Revenue Opportunity Factory as a control-plane blueprint without pretending a native adapter exists', () => {
    const definitions = listFactoryDefinitions()
    const revenue = definitions.find((item) => item.module.id === 'revenue-opportunity-factory')
    expect(revenue?.module.name).toBe('Revenue Opportunity Factory')
    expect(revenue?.module.state_authority).toBe('tower')
    expect(revenue?.learning_policy).toMatchObject({
      evidence_gate_required_before_build: true,
      build_target: 'product-factory',
    })
    expect(listFactoryAdapters().some((adapter) => adapter.moduleId === 'revenue-opportunity-factory')).toBe(false)
  })
})
