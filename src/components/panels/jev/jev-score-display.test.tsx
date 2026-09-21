import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JevAnswerCards } from './jev-answer-cards'
import type { JevRunResult } from './jev-ui-types'

describe('Human-readable score levels', () => {
  it('matches the editor’s one-based labels without changing stored provider data', () => {
    const result: JevRunResult = { id: 'test', model: 'jev', latencyMs: 1, requestId: null,
      usage: { input_tokens: 1, output_tokens: 1 }, answers: { quality: {
        type: 'score', score: 1.2, legend: { 0: 'Low', 1: 'Medium', 2: 'High' },
        probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 },
      } } }
    const original = JSON.stringify(result)
    render(<JevAnswerCards result={result} />)
    expect(screen.getByText('Score: 2.20 of 3')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '1 — Low probability' })).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByRole('progressbar', { name: '3 — High probability' })).toBeInTheDocument()
    expect(JSON.stringify(result)).toBe(original)
  })

  it('does not renumber a non-contiguous legacy scale', () => {
    render(<JevAnswerCards result={{ id: 'test', model: 'jev', latencyMs: 1, requestId: null,
      usage: { input_tokens: 1, output_tokens: 1 }, answers: { quality: {
        type: 'score', score: 15, probabilities: { 10: 0.5, 20: 0.5 }, legend: { 10: 'Low', 20: 'High' },
      } } }} />)
    expect(screen.getByText('Score: 15.00')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '10 — Low probability' })).toBeInTheDocument()
  })
})
