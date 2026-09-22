import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JevFlowSteps } from './jev-flow-steps'

const LABELS = ['Describe', 'Questions', 'Review', 'Evaluate', 'Results']

function steps() {
  return within(screen.getByRole('navigation', { name: 'Jev session steps' })).getAllByRole('listitem')
}

describe('JevFlowSteps', () => {
  it('renders every stage of a session in order', () => {
    render(<JevFlowSteps current="describe" />)
    expect(steps().map((item) => item.textContent)).toHaveLength(LABELS.length)
    for (const label of LABELS) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('marks only the current stage with aria-current', () => {
    render(<JevFlowSteps current="review" />)
    const current = steps().filter((item) => item.querySelector('[aria-current="step"]'))
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Review')
  })

  it('describes earlier stages as completed and later stages as not started', () => {
    render(<JevFlowSteps current="evaluate" />)
    const items = steps()
    expect(items[0]).toHaveTextContent('completed')
    expect(items[2]).toHaveTextContent('completed')
    expect(items[3]).toHaveTextContent('current step')
    expect(items[4]).toHaveTextContent('not started')
  })

  it('shows a position summary when no back handler is supplied', () => {
    render(<JevFlowSteps current="results" />)
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('invokes the back handler with the supplied label', () => {
    const onBack = vi.fn()
    render(<JevFlowSteps current="results" onBack={onBack} backLabel="Back to setup" />)
    fireEvent.click(screen.getByRole('button', { name: '← Back to setup' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('does not fire the back handler while the stage is busy', () => {
    const onBack = vi.fn()
    render(<JevFlowSteps current="evaluate" onBack={onBack} backDisabled />)
    const button = screen.getByRole('button', { name: '← Back' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('falls back to the first stage for an unknown step', () => {
    render(<JevFlowSteps current={'nonsense' as never} />)
    expect(steps()[0]).toHaveTextContent('current step')
  })
})
