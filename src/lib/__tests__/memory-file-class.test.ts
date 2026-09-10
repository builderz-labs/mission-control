import { describe, expect, it } from 'vitest'
import {
  classifyMemoryPath,
  hasDiscoverabilityField,
  isHealthScored,
} from '@/lib/memory-file-class'

describe('classifyMemoryPath', () => {
  it('marks session mirrors as session corpus', () => {
    expect(classifyMemoryPath('sessions/actz-may/codex-cli/abc.md')).toBe('session')
    expect(isHealthScored('sessions/actz-may/codex-cli/abc.md')).toBe(false)
  })

  it('marks SKILL.md and skill package internals as skill-doc', () => {
    expect(classifyMemoryPath('ruflo/SKILL.md')).toBe('skill-doc')
    expect(isHealthScored('adaptive-context/SKILL.md')).toBe(false)
    expect(classifyMemoryPath('cloudflare/references/kv.md')).toBe('skill-doc')
    expect(classifyMemoryPath('Raw/Sources/note.md')).toBe('generated')
    expect(isHealthScored('Wiki/Concepts/dev-fleet.md')).toBe(true)
  })

  it('scores compiled hubs', () => {
    expect(classifyMemoryPath('fleet-index.md')).toBe('compiled')
    expect(classifyMemoryPath('Wiki/Concepts/dev-fleet.md')).toBe('compiled')
    expect(isHealthScored('unified-brain-graph.md')).toBe(true)
  })
})

describe('hasDiscoverabilityField', () => {
  it('accepts description frontmatter', () => {
    expect(hasDiscoverabilityField('---\ndescription: Fleet map\n---\n# x\n')).toBe(true)
  })

  it('accepts wiki tags lists', () => {
    expect(hasDiscoverabilityField('---\ntags:\n  - "concept"\n---\n# x\n')).toBe(true)
  })

  it('rejects empty frontmatter', () => {
    expect(hasDiscoverabilityField('---\nkind: grok\n---\n# Session\n')).toBe(false)
  })
})
