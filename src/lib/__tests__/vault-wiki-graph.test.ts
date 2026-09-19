import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadBrainGraph, loadClaudeHistoryGraph, loadHistoryGraph, loadSkillsGraph, loadVaultWikiGraph } from '@/lib/vault-wiki-graph'
import { parseWikiDoctorOutput } from '@/lib/vault-health'

describe('vault wiki graph', () => {
  it('turns catalog rows into a vault graph hub', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-vault-graph-'))
    mkdirSync(path.join(root, 'Wiki'))
    writeFileSync(
      path.join(root, 'Wiki', 'catalog.jsonl'),
      `${JSON.stringify({ path: 'Wiki/Topics/brain.md', topics: ['[[relay]]'], sources: ['Raw/Sources/a.md'] })}\n`,
    )
    const graph = loadVaultWikiGraph(root)
    expect(graph?.name).toBe('omnia-vault')
    expect(graph?.totalFiles).toBe(1)
    expect(graph?.files[0]?.chunks).toBe(3)
  })

  it('loads Claude history projects into a graph hub', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-claude-hist-'))
    writeFileSync(
      path.join(root, 'claude-history.json'),
      JSON.stringify({
        projects: [{ path: 'claude-history/~/Dev/actz-may', sessions: 12 }],
        stores: [{ path: 'claude-desktop/local-agent-mode-sessions', sessions: 4 }],
      }),
    )
    const graph = loadClaudeHistoryGraph(path.join(root, 'claude-history.json'))
    expect(graph?.name).toBe('claude-history')
    expect(graph?.totalFiles).toBe(2)
    expect(graph?.totalChunks).toBe(16)
  })

  it('loads a brain-graph hub from nodes and edges', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-brain-graph-'))
    writeFileSync(
      path.join(root, 'brain-graph.json'),
      JSON.stringify({
        name: 'brain-graph',
        nodes: [{ id: 'agent:codex' }, { id: 'vault:omnia-vault' }],
        edges: [{ from: 'agent:codex', to: 'vault:omnia-vault' }],
      }),
    )
    const graph = loadBrainGraph(path.join(root, 'brain-graph.json'))
    expect(graph?.name).toBe('brain-graph')
    expect(graph?.totalFiles).toBe(2)
    expect(graph?.totalChunks).toBe(3)
  })

  it('loads a named engine-history hub', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-engine-hist-'))
    writeFileSync(
      path.join(root, 'engine-history.json'),
      JSON.stringify({ name: 'engine-history', projects: [{ path: 'engine-history/codex', sessions: 8 }] }),
    )
    const graph = loadHistoryGraph(path.join(root, 'engine-history.json'), 'engine-history')
    expect(graph?.name).toBe('engine-history')
    expect(graph?.files[0]?.chunks).toBe(8)
  })

  it('lists SKILL.md files as the skills hub', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-skills-graph-'))
    mkdirSync(path.join(root, 'obsidian'))
    mkdirSync(path.join(root, 'gsap-skills', 'gsap-core'), { recursive: true })
    writeFileSync(path.join(root, 'obsidian', 'SKILL.md'), '# obsidian\n')
    writeFileSync(path.join(root, 'gsap-skills', 'gsap-core', 'SKILL.md'), '# gsap-core\n')
    const graph = loadSkillsGraph(root)
    expect(graph?.name).toBe('skills')
    expect(graph?.files.map((file) => file.path)).toEqual([
      'skills/obsidian/SKILL.md',
      'skills/gsap-skills/gsap-core/SKILL.md',
    ])
  })
})

describe('vault doctor parse', () => {
  it('marks doctor OK as healthy', () => {
    const category = parseWikiDoctorOutput('ok catalog: 31 entries\ndoctor: OK\n')
    expect(category.status).toBe('healthy')
    expect(category.score).toBe(100)
  })
})
