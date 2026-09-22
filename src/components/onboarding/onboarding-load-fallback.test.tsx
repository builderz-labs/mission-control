import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingLoadFallback } from './onboarding-load-fallback'

describe('Onboarding load recovery', () => {
  it('always gives users a visible exit during loading', () => {
    const onContinue = vi.fn()
    render(<OnboardingLoadFallback failed={false} onRetry={vi.fn()} onContinue={onContinue} />)
    expect(screen.getByRole('dialog', { name: 'Loading your setup…' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('will not be marked complete')
    const button = screen.getByRole('button', { name: 'Continue to Mission Control' })
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('offers both retry and continue after failure', () => {
    const onRetry = vi.fn()
    render(<OnboardingLoadFallback failed onRetry={onRetry} onContinue={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('retry or continue')
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Continue to Mission Control' })).toBeEnabled()
  })

  it('lets keyboard users leave without a server request', () => {
    const onContinue = vi.fn()
    render(<OnboardingLoadFallback failed={false} onRetry={vi.fn()} onContinue={onContinue} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
