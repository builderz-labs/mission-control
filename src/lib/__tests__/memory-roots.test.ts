import { describe, expect, it } from 'vitest'
import { fleetMemoryRoots, isSharedMemoryWritePath, locateMemoryPath } from '@/lib/memory-roots'

describe('fleet memory roots', () => {
  it('locates vault wiki paths and blocks writes outside openclaw', () => {
    const roots = fleetMemoryRoots()
    const vault = roots.find((root) => root.id === 'omnia-vault')
    if (!vault) return
    const located = locateMemoryPath('omnia-vault/Wiki/Logs/index.md', roots)
    expect(located?.root.id).toBe('omnia-vault')
    expect(located?.rest).toBe('Wiki/Logs/index.md')
    expect(locateMemoryPath('omnia-vault/.obsidian/workspace.json', roots)).toBeNull()
    expect(locateMemoryPath('omnia-vault/.claude/skills/relay/SKILL.md', roots)?.rest).toBe(
      '.claude/skills/relay/SKILL.md',
    )
    expect(isSharedMemoryWritePath('omnia-vault/Wiki/Logs/index.md')).toBe(false)
  })

  it('allows OpenClaw memory writes when that root exists', () => {
    const roots = fleetMemoryRoots()
    if (!roots.some((root) => root.id === 'openclaw')) return
    expect(locateMemoryPath('openclaw/fleet-index.md', roots)?.rest).toBe('fleet-index.md')
    expect(isSharedMemoryWritePath('openclaw/fleet-index.md')).toBe(true)
  })
})
