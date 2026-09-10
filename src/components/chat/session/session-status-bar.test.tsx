import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { SessionStatusBar } from './session-status-bar'
import en from '../../../../messages/en.json'

function wrap(ui: React.ReactElement) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>
}

describe('SessionStatusBar', () => {
  it('glimmers the bottom line while the agent is working', () => {
    const { rerender } = render(wrap(<SessionStatusBar status="Idle" live={false} />))
    expect(screen.getByText('Idle').parentElement?.className).not.toContain('chat-glimmer-line')
    rerender(wrap(<SessionStatusBar status="Thinking" live />))
    const bar = screen.getByText('Thinking').parentElement
    expect(bar?.className).toContain('chat-glimmer-line')
    expect(bar?.getAttribute('aria-live')).toBe('polite')
  })
})
