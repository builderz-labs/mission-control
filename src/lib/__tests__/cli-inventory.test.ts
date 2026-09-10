import { describe, expect, it } from 'vitest'
import { inventoryForAgent, inventoryLooksSafe } from '@/lib/cli-inventory'

describe('cli inventory', () => {
  it('returns connectors for fleet agents without secret fields', () => {
    const grok = inventoryForAgent('grok')
    expect(grok.runtime).toBe('grok')
    expect(inventoryLooksSafe(grok)).toBe(true)
    const unknown = inventoryForAgent('claude')
    expect(unknown.connectors).toEqual([])
  })
})
