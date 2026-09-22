import { describe, expect, it } from 'vitest'
import { isAgentWorking, type TranscriptMessage } from '../session-transcript-types'

const thinking: TranscriptMessage = {
  role: 'assistant',
  parts: [{ type: 'thinking', thinking: 'planning the fix' }],
}

const toolOpen: TranscriptMessage = {
  role: 'assistant',
  parts: [{ type: 'tool_use', id: '1', name: 'read', input: 'src/app.ts' }],
}

const done: TranscriptMessage = {
  role: 'assistant',
  parts: [{ type: 'text', text: 'done' }],
}

describe('isAgentWorking', () => {
  it('is live when the session is active or the composer is busy', () => {
    expect(isAgentWorking([], { active: true })).toBe(true)
    expect(isAgentWorking([], { busy: true })).toBe(true)
    expect(isAgentWorking([])).toBe(false)
  })

  it('is live while the latest assistant turn is thinking or using a tool', () => {
    expect(isAgentWorking([thinking])).toBe(true)
    expect(isAgentWorking([toolOpen])).toBe(true)
    expect(isAgentWorking([done])).toBe(false)
  })
})
