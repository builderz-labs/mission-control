import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inventoryForAgent } from '@/lib/cli-inventory'
import { collectFleetWikiStems } from '@/lib/memory-stems'
import { runHealthDiagnostics } from '@/lib/memory-utils'

describe('live openclaw memory health', () => {
  const memoryRoot = join(homedir(), '.openclaw', 'memory')

  it('scores compiled hubs without treating session dumps as orphans', async () => {
    if (!existsSync(memoryRoot)) return
    const extraStems = collectFleetWikiStems()
    const report = await runHealthDiagnostics(memoryRoot, { extraStems })
    const byName = Object.fromEntries(report.categories.map((category) => [category.name, category]))
    expect(byName.Connectivity.score).toBeGreaterThanOrEqual(70)
    expect(byName['Link Integrity'].score).toBeGreaterThanOrEqual(90)
    expect(byName['Description Quality'].score).toBeGreaterThanOrEqual(60)
    expect(byName.Connectivity.issues.join(' ')).not.toMatch(/session/)
  })

  it('indexes MCP names for claude-1 when live connectors are configured', () => {
    const inventory = inventoryForAgent('claude-1')
    expect(inventory.runtime).toBe('claude')
    if (inventory.connectors.length === 0) return
    expect(inventory.connectors.every(({ name }) => name.length > 0)).toBe(true)
  })
})
