import { describe, expect, it } from 'vitest'
import { parseSkillDescription } from '@/lib/skill-frontmatter'

describe('parseSkillDescription', () => {
  it('reads YAML description instead of ---', () => {
    const content = `---
name: adaptive-context
description: "Pick a safe context window."
---

# Adaptive context
`
    expect(parseSkillDescription(content)).toBe('Pick a safe context window.')
  })

  it('falls back to first prose paragraph', () => {
    expect(parseSkillDescription('# Demo\n\nDoes a thing.\n')).toBe('Does a thing.')
  })

  it('unfolds YAML > descriptions', () => {
    const content = `---
name: demo
description: >
  Folded description line.
---
`
    expect(parseSkillDescription(content)).toBe('Folded description line.')
  })
})
