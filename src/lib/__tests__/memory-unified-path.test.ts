/**
 * Integration test: verifies the TypeScript addMemoryEntry delegates to the
 * canonical CJS writeMemory. createRequire bypasses Vite mocking, so we
 * test behaviorally — call TS, read back via CJS, confirm same DB entry.
 */

import { describe, it, expect } from 'vitest'
import { addMemoryEntry } from '../memory-service.js'
// Import CJS directly — same module instance as the TS file uses
import memSvc from '../../../scripts/memory-service.cjs'

const UNIQUE_TAG = `unified-path-test-${Date.now()}`

describe('memory-service unified path', () => {
  it('addMemoryEntry returns { id: number }', async () => {
    const result = await addMemoryEntry({ source: 'test-unified', content: 'probe entry' })
    expect(typeof result.id).toBe('number')
    expect(result.id).toBeGreaterThan(0)
  })

  it('entry written by addMemoryEntry is readable by CJS queryMemory', async () => {
    const content = `unified-path-probe-${UNIQUE_TAG}`
    const { id } = await addMemoryEntry({ source: 'test-unified', content })
    expect(id).toBeGreaterThan(0)

    // Read back via the canonical CJS path
    const rows = memSvc.queryMemory(UNIQUE_TAG) as Array<{ id: number; source: string; content: string }>
    const row = rows.find(r => r.id === id)
    expect(row).toBeDefined()
    expect(row!.source).toBe('test-unified')
    expect(row!.content).toBe(content)
  })

  it('addMemoryEntry with category and source_ref writes correct fields', async () => {
    const content = `cat-test-${UNIQUE_TAG}`
    const { id } = await addMemoryEntry({
      source: 'test-unified',
      category: 'audit',
      content,
      source_ref: 'ref-unified',
      confidence: 0.75,
    })
    expect(id).toBeGreaterThan(0)

    const rows = memSvc.queryMemory(content) as Array<{ id: number; category: string; confidence: number }>
    const row = rows.find(r => r.id === id)
    expect(row).toBeDefined()
    expect(row!.category).toBe('audit')
    expect(row!.confidence).toBeCloseTo(0.75)
  })

  it('no duplicate paths — single write produces single DB row', async () => {
    const content = `single-row-${UNIQUE_TAG}`
    await addMemoryEntry({ source: 'test-unified', content })

    const rows = memSvc.queryMemory(content) as Array<{ content: string }>
    const matching = rows.filter(r => r.content === content)
    expect(matching).toHaveLength(1)
  })
})
