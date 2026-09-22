import { describe, expect, it } from 'vitest'
import {
  commandArguments,
  terminalCursorLabel,
  transcriptToTerminalLines,
} from '../terminal-transcript'
import { orderTerminalSessions, terminalTabId, TERMINAL_TAB_LIMIT } from '../terminal-sessions'
import type { TranscriptMessage } from '../session-transcript-types'
import type { DashboardSession } from '../dashboard-cli-fleets'

function kinds(messages: TranscriptMessage[]): string[] {
  return transcriptToTerminalLines(messages).map((line) => `${line.kind}|${line.text}`)
}

describe('transcriptToTerminalLines', () => {
  it('renders a user turn as a shell prompt and the reply as output', () => {
    expect(kinds([
      { role: 'user', parts: [{ type: 'text', text: 'run the tests' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'All 12 passed.' }] },
    ])).toEqual(['prompt|❯ run the tests', 'output|All 12 passed.'])
  })

  it('renders a tool call as a command line with its output indented below', () => {
    expect(kinds([
      {
        role: 'assistant',
        parts: [{
          type: 'tool_use',
          id: 't1',
          name: 'Bash',
          input: '{"command":"pnpm test"}',
          result: 'ok\ndone',
        }],
      },
    ])).toEqual(['command|$ Bash "command":"pnpm test"', 'result|  ok', 'result|  done'])
  })

  it('marks failing tool output as an error', () => {
    const lines = transcriptToTerminalLines([
      { role: 'assistant', parts: [{ type: 'tool_result', toolUseId: 't1', content: 'boom', isError: true }] },
    ])
    expect(lines).toEqual([{ id: 'l0', kind: 'error', text: '  boom' }])
  })

  it('drops system-reminder noise from the user prompt stream', () => {
    expect(kinds([
      { role: 'user', parts: [{ type: 'text', text: '<system-reminder>ignore me</system-reminder>' }] },
      { role: 'user', parts: [{ type: 'text', text: 'real prompt' }] },
    ])).toEqual(['prompt|❯ real prompt'])
  })

  it('clamps long tool output and says how much was elided', () => {
    const content = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
    const lines = transcriptToTerminalLines([
      { role: 'assistant', parts: [{ type: 'tool_result', toolUseId: 't1', content }] },
    ])
    expect(lines).toHaveLength(13)
    expect(lines[12]).toMatchObject({ kind: 'meta', text: '  … 8 more lines' })
  })

  it('strips ANSI colour codes rather than printing them literally', () => {
    const lines = transcriptToTerminalLines([
      { role: 'assistant', parts: [{ type: 'text', text: '[31mred[0m text' }] },
    ])
    expect(lines[0].text).toBe('red text')
  })

  it('produces unique keys for repeated identical lines', () => {
    const lines = transcriptToTerminalLines([
      { role: 'assistant', parts: [{ type: 'text', text: 'same\nsame\nsame' }] },
    ])
    expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length)
  })

  it('returns nothing for an empty transcript', () => {
    expect(transcriptToTerminalLines([])).toEqual([])
  })
})

describe('commandArguments', () => {
  it('flattens JSON input to one line and unwraps the outer braces', () => {
    expect(commandArguments('{\n  "path": "a.ts"\n}')).toBe('"path": "a.ts"')
  })

  it('returns an empty string for an empty argument object', () => {
    expect(commandArguments('{}')).toBe('')
    expect(commandArguments('')).toBe('')
  })

  it('truncates very long arguments', () => {
    expect(commandArguments('x'.repeat(400))).toHaveLength(121)
  })
})

describe('terminalCursorLabel', () => {
  it('reports work in progress, live idle, and closed sessions differently', () => {
    expect(terminalCursorLabel(true, true)).toBe('❯ running…')
    expect(terminalCursorLabel(false, true)).toBe('❯ ')
    expect(terminalCursorLabel(false, false)).toBe('❯ (session idle)')
  })
})

function session(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return { id, kind: 'claude-code', ...over }
}

describe('orderTerminalSessions', () => {
  it('puts live sessions first, then the most recently active', () => {
    const ordered = orderTerminalSessions([
      session('idle-old', { lastActivity: 10 }),
      session('idle-new', { lastActivity: 90 }),
      session('live', { active: true, lastActivity: 5 }),
    ])
    expect(ordered.map((item) => item.id)).toEqual(['live', 'idle-new', 'idle-old'])
  })

  it('caps the tab strip so a large host stays usable', () => {
    const many = Array.from({ length: 200 }, (_, index) => session(`s${index}`))
    expect(orderTerminalSessions(many)).toHaveLength(TERMINAL_TAB_LIMIT)
  })

  it('keeps ids distinct across sources and engines', () => {
    expect(terminalTabId(session('a', { source: 'gateway', kind: 'grok' })))
      .not.toBe(terminalTabId(session('a', { source: 'local', kind: 'grok' })))
  })
})
