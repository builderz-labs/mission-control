import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureWorkspaceGeneratedFiles } from '@/lib/workspace-sync'

describe('ensureWorkspaceGeneratedFiles', () => {
  it('writes TOOLS.md and MISSION.md and keeps hand edits outside markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-ws-'))
    mkdirSync(dir, { recursive: true })
    ensureWorkspaceGeneratedFiles(dir, 'grok')
    const tools = readFileSync(join(dir, 'TOOLS.md'), 'utf8')
    expect(tools).toContain('generated:cli-inventory')
    expect(tools).toContain('# Tools')
    writeFileSync(join(dir, 'TOOLS.md'), `${tools}\n\n## Hand edit\nkeep me\n`, 'utf8')
    ensureWorkspaceGeneratedFiles(dir, 'grok')
    const again = readFileSync(join(dir, 'TOOLS.md'), 'utf8')
    expect(again).toContain('keep me')
    expect(readFileSync(join(dir, 'MISSION.md'), 'utf8')).toContain('Fleet identity `grok`')
  })
})
