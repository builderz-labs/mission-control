import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listExtraSkillRoots, listSkillRoots, skillTargetDir, SKILL_INSTALL_TARGETS } from '@/lib/skill-roots'

describe('listSkillRoots', () => {
  const originalHome = process.env.HOME
  let tempDir = ''

  afterEach(() => {
    process.env.HOME = originalHome
    delete process.env.MC_SKILLS_USER_AGENTS_DIR
    delete process.env.MC_SKILLS_USER_CODEX_DIR
    if (tempDir) {
      tempDir = ''
    }
  })

  it('dedupes product skill roots that symlink to the same tree', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-skills-'))
    const canonical = path.join(tempDir, 'canonical')
    mkdirSync(path.join(canonical, 'demo'), { recursive: true })
    writeFileSync(path.join(canonical, 'demo', 'SKILL.md'), '# demo\n')
    const linked = path.join(tempDir, 'codex-skills')
    symlinkSync(canonical, linked)
    process.env.MC_SKILLS_USER_AGENTS_DIR = canonical
    process.env.MC_SKILLS_USER_CODEX_DIR = linked
    process.env.HOME = tempDir
    const roots = listSkillRoots()
    const sources = roots.map((root) => root.source)
    expect(sources).toContain('user-agents')
    expect(sources).not.toContain('user-codex')
  })

  it('resolves workspace and grok/kimi install targets', () => {
    expect(SKILL_INSTALL_TARGETS).toContain('workspace')
    expect(SKILL_INSTALL_TARGETS).toContain('user-grok')
    expect(SKILL_INSTALL_TARGETS).toContain('user-kimi')
    expect(skillTargetDir('workspace')).toContain('.openclaw')
    expect(skillTargetDir('user-grok')).toContain('.grok')
    expect(skillTargetDir('user-kimi')).toContain('.kimi-code')
  })

  it('lists bundled plugin skill roots separately from the canonical tree', () => {
    const extras = listExtraSkillRoots().map((root) => root.source)
    expect(extras.every((source) => source !== 'user-agents')).toBe(true)
  })
})
