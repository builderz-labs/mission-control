import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gapDetectPass, runHealthDiagnostics } from '@/lib/memory-utils'

function writeNote(dir: string, name: string, body: string) {
  writeFileSync(join(dir, name), body, 'utf8')
}

describe('health scoring classes', () => {
  it('ignores session dumps and resolves extra wiki stems', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-health-'))
    mkdirSync(join(dir, 'sessions', 'demo', 'grok'), { recursive: true })
    writeNote(
      dir,
      'fleet-index.md',
      '---\ndescription: Fleet control plane index\n---\n\nSee [[unified-brain-graph]] and [[dev-fleet]].\n',
    )
    writeNote(
      join(dir, 'sessions', 'demo', 'grok'),
      'abc.md',
      '---\nkind: grok\nsession_id: abc\n---\n\n# Session\norphan dump\n',
    )

    const report = await runHealthDiagnostics(dir, {
      extraStems: ['unified-brain-graph', 'dev-fleet'],
    })
    const byName = Object.fromEntries(report.categories.map((category) => [category.name, category]))
    expect(byName.Connectivity.score).toBe(100)
    expect(byName['Link Integrity'].score).toBe(100)
    expect(byName['Description Quality'].score).toBe(100)
    expect(byName.Connectivity.issues).toEqual([])

    const gaps = await gapDetectPass(dir, { extraStems: ['unified-brain-graph', 'dev-fleet'] })
    expect(gaps.summary.orphans).toBe(0)
    expect(gaps.summary.brokenLinks).toBe(0)
  })
})
