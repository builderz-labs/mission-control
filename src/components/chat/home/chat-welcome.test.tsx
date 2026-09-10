import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ChatWelcome } from './chat-welcome'
import en from '../../../../messages/en.json'

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ChatWelcome', () => {
  it('renders empty sessions and pull requests', () => {
    render(wrap(
      <ChatWelcome displayName="Ty DeVries" sessions={[]} pullRequests={[]} onSelectSession={() => undefined} />,
    ))
    expect(screen.getByText('Welcome back, Ty')).toBeInTheDocument()
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
    expect(screen.getByText('No pull requests')).toBeInTheDocument()
  })
})
