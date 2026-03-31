import { describe, expect, it } from 'vitest'

describe('getHermesMemory', () => {
  it('counts live Hermes memory entries even when the files use plain lines instead of section markers', async () => {
    const { getHermesMemory } = await import('@/lib/hermes-memory')
    const result = getHermesMemory()

    expect(result.agentMemoryEntries).toBeGreaterThan(0)
    expect(result.userMemoryEntries).toBeGreaterThan(0)
  })
})
