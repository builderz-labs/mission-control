import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LiveFeed } from './live-feed'

const actions = vi.hoisted(() => ({ select: vi.fn(), navigate: vi.fn() }))
vi.mock('@/lib/navigation', () => ({ useNavigateToPanel: () => actions.navigate }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/store', () => ({ useMissionControl: () => ({
  logs: [], activities: [], connection: {}, dashboardMode: 'local', toggleLiveFeed: vi.fn(),
  setActiveConversation: actions.select,
  sessions: [{ id: 'example-session', kind: 'codex-cli', key: 'Repair search', active: true, model: 'codex' }],
}) }))

it('opens an active sidebar session with the mouse or keyboard-accessible button', () => {
  render(<LiveFeed />)
  fireEvent.click(screen.getByTitle('showLiveFeed'))
  const session = screen.getByRole('button', { name: /Repair search/ })
  expect(session).toHaveAttribute('type', 'button')
  fireEvent.click(session)
  expect(actions.select).toHaveBeenCalledWith('session:codex-cli:example-session')
  expect(actions.navigate).toHaveBeenCalledWith('chat')
})
