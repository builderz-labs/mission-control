import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_CHAT_FILTERS } from '@/lib/group-sessions'
import { ChatFilterPopover } from './chat-filter-popover'
import en from '../../../../messages/en.json'

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ChatFilterPopover', () => {
  it('toggles show PR status', () => {
    const onChange = vi.fn()
    render(wrap(
      <ChatFilterPopover value={DEFAULT_CHAT_FILTERS} onChange={onChange} onClose={() => undefined} />,
    ))
    fireEvent.click(screen.getByRole('button', { name: /Show PR status/i }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_FILTERS, showPrStatus: false })
  })
})
