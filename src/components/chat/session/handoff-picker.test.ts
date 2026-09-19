import { describe, expect, it } from 'vitest'
import { HANDOFF_SEATS } from './handoff-picker'

describe('HandoffPicker seats', () => {
  it('lists both Claude seats plus Codex, Grok, and Kimi', () => {
    expect(HANDOFF_SEATS.map((seat) => seat.id)).toEqual([
      'claude-1', 'claude-2', 'codex', 'grok', 'kimi',
    ])
  })
})
