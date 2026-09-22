import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SessionThread } from './session-thread'

describe('SessionThread', () => {
  it('adds a glimmer line under the live stream while the agent is working', () => {
    const { container, rerender } = render(
      <SessionThread messages={[{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]} />,
    )
    expect(container.querySelector('.chat-glimmer-line')).toBeNull()
    rerender(
      <SessionThread
        live
        messages={[{ role: 'assistant', parts: [{ type: 'thinking', thinking: 'plan' }] }]}
      />,
    )
    expect(container.querySelector('.chat-glimmer-line')).toBeTruthy()
  })
})
