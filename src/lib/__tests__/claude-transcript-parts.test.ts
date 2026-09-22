import { describe, expect, it } from 'vitest'
import { attachToolResults, dedupeConsecutiveText, toolLabel } from '../claude-transcript-parts'
import { parseClaudeTranscriptLines } from '../claude-transcript'

describe('toolLabel', () => {
  it('uses Bash description and Agent lane titles', () => {
    expect(toolLabel('Bash', { description: 'Run typecheck', command: 'pnpm tsc' })).toBe('Run typecheck')
    expect(toolLabel('Agent', { description: 'Lane 0.67 reversible marker', prompt: 'long' }))
      .toBe('Agent · Lane 0.67 reversible marker')
  })
})

describe('attachToolResults + dedupe', () => {
  it('folds tool_result into the matching tool_use and drops duplicate limit lines', () => {
    const attached = attachToolResults([
      { role: 'assistant', parts: [{ type: 'tool_use', id: 't1', name: 'Bash', input: 'pnpm tsc', label: 'Run typecheck' }] },
      { role: 'system', parts: [{ type: 'tool_result', toolUseId: 't1', content: 'ok' }] },
    ])
    expect(attached).toHaveLength(1)
    expect(attached[0].parts[0]).toMatchObject({ type: 'tool_use', result: 'ok' })
    const deduped = dedupeConsecutiveText([
      { role: 'assistant', parts: [{ type: 'text', text: 'You\'ve hit your session limit' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'You\'ve hit your session limit' }] },
    ])
    expect(deduped).toHaveLength(1)
  })
})

describe('parseClaudeTranscriptLines', () => {
  it('parses pr-link, frame-link, and bash descriptions', () => {
    const id = 'e4deed8c-8578-4c6d-a421-175443c87942'
    const lines = [
      JSON.stringify({ type: 'pr-link', sessionId: id, prNumber: 69, prUrl: 'https://github.com/org/repo/pull/69', prRepository: 'org/repo' }),
      JSON.stringify({ type: 'frame-link', sessionId: id, title: 'Franchise Readiness Register', frameUrl: 'https://claude.ai/code/artifact/abc', path: '/tmp/plan.html' }),
      JSON.stringify({
        type: 'assistant', sessionId: id,
        message: { content: [{ type: 'tool_use', id: '1', name: 'Bash', input: { command: 'pnpm tsc', description: 'Run typecheck' } }] },
      }),
    ]
    const parsed = parseClaudeTranscriptLines(lines, id, 40)
    expect(parsed.some((row) => row.parts.some((part) => part.type === 'pr_link' && part.number === 69))).toBe(true)
    expect(parsed.some((row) => row.parts.some((part) => part.type === 'artifact' && part.title === 'Franchise Readiness Register'))).toBe(true)
    const bash = parsed.flatMap((row) => row.parts).find((part) => part.type === 'tool_use')
    expect(bash).toMatchObject({ type: 'tool_use', label: 'Run typecheck', input: 'pnpm tsc' })
  })

  it('skips empty frame-links and keeps the last named artifact past the slice', () => {
    const id = 'e4deed8c-8578-4c6d-a421-175443c87942'
    const lines = [
      JSON.stringify({
        type: 'frame-link', sessionId: id, title: 'Franchise Readiness Register',
        frameUrl: 'https://claude.ai/code/artifact/abc', path: '/private/tmp/plan.html',
      }),
      JSON.stringify({ type: 'frame-link', sessionId: id }),
      JSON.stringify({ type: 'user', sessionId: id, message: { content: 'one' } }),
      JSON.stringify({ type: 'user', sessionId: id, message: { content: 'two' } }),
    ]
    const parsed = parseClaudeTranscriptLines(lines, id, 2)
    expect(parsed.some((row) => row.parts.some((part) => part.type === 'artifact' && part.title === 'Artifact'))).toBe(false)
    expect(parsed.some((row) => row.parts.some((part) => part.type === 'artifact' && part.title === 'Franchise Readiness Register'))).toBe(true)
    expect(parsed.filter((row) => row.role === 'user')).toHaveLength(2)
  })

  it('drops task-notification user rows', () => {
    const id = 'e4deed8c-8578-4c6d-a421-175443c87942'
    const parsed = parseClaudeTranscriptLines([
      JSON.stringify({ type: 'user', sessionId: id, message: { content: '<task-notification>agent failed</task-notification>' } }),
      JSON.stringify({ type: 'user', sessionId: id, message: { content: 'keep this' } }),
    ], id, 40)
    expect(parsed.map((row) => row.role)).toEqual(['user'])
    expect(parsed[0].parts[0]).toEqual({ type: 'text', text: 'keep this' })
  })
})
