import { describe, expect, it } from 'vitest'
import { extractSessionArtifacts, latestArtifact } from '../session-artifacts'

describe('session artifacts', () => {
  it('ignores empty frame placeholders and returns the last named artifact', () => {
    const messages = [
      { role: 'system' as const, parts: [{ type: 'artifact' as const, title: 'Franchise Readiness Register', url: 'https://claude.ai/code/artifact/abc', path: '/private/tmp/plan.html' }] },
      { role: 'system' as const, parts: [{ type: 'artifact' as const, title: 'Artifact' }] },
      { role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'done' }] },
    ]
    expect(extractSessionArtifacts(messages)).toEqual([
      { title: 'Franchise Readiness Register', url: 'https://claude.ai/code/artifact/abc', path: '/private/tmp/plan.html' },
    ])
    expect(latestArtifact(messages)?.title).toBe('Franchise Readiness Register')
  })
})
