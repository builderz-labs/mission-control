import { describe, expect, it } from 'vitest'
import { buildHandoffBrief, HANDOFF_BRIEF_MAX } from '../handoff-brief'

describe('buildHandoffBrief', () => {
  it('includes tools, artifacts, and recent assistant text for the target engine', () => {
    const prompt = buildHandoffBrief({
      title: 'Franchise readiness agent handoff',
      sourceKind: 'claude-code',
      sourceId: 'sess-handoff-1',
      project: '/Users/dev/stillpoint-builders',
      sourceAgent: 'claude-1',
      targetAgent: 'codex',
      window: 245400,
      messages: [
        { role: 'system', parts: [{ type: 'artifact', title: 'Franchise Readiness Register', url: 'https://claude.ai/code/artifact/abc' }] },
        { role: 'system', parts: [{ type: 'pr_link', number: 69, url: 'https://github.com/org/repo/pull/69', repo: 'org/repo' }] },
        { role: 'assistant', parts: [{ type: 'tool_use', id: '1', name: 'Bash', label: 'Run typecheck', input: 'pnpm exec tsc --pretty false src/lib/handoff-brief.ts', result: 'green sk-live-secret-token-value' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Dispatch nine bounded lanes next.' }] },
      ],
    })
    expect(prompt).toContain('Franchise Readiness Register')
    expect(prompt).toContain('#69')
    expect(prompt).toContain('Run typecheck')
    expect(prompt).toContain('src/lib/handoff-brief.ts')
    expect(prompt).not.toContain('sk-live-secret-token-value')
    expect(prompt).toContain('Dispatch nine bounded lanes')
    expect(prompt).toContain('stillpoint-builders')
    expect(prompt).toContain('claude-1')
    expect(prompt).toContain('Shared context window: 245400')
    expect(prompt.length).toBeLessThanOrEqual(HANDOFF_BRIEF_MAX)
  })
})
