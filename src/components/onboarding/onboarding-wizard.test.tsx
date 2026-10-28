import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { OnboardingWizard } from './onboarding-wizard'

const actions = vi.hoisted(() => ({ close: vi.fn(), fetch: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/lib/api-client', () => ({ apiFetch: actions.fetch }))
vi.mock('@/lib/navigation', () => ({ useNavigateToPanel: () => vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/components/onboarding/security-scan-card', () => ({ SecurityScanCard: () => null }))
vi.mock('@/store', () => ({ useMissionControl: () => ({
  showOnboarding: true, setShowOnboarding: actions.close, dashboardMode: 'local',
  gatewayAvailable: false, interfaceMode: 'essential', setInterfaceMode: vi.fn(),
}) }))

it('shows a closable dialog while setup is pending without persisting a skip', () => {
  render(<OnboardingWizard />)
  expect(screen.getByRole('dialog', { name: 'Loading setup' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Loading setup')
  fireEvent.click(screen.getByRole('button', { name: 'Close for now' }))
  expect(actions.close).toHaveBeenCalledWith(false)
  expect(actions.fetch.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true)
})
