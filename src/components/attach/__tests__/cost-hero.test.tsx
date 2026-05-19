import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CostHero } from '../cost-hero'

describe('CostHero', () => {
  it('renders formatted USD cost', () => {
    render(<CostHero totalCost={4.2} requestCount={42} totalTokens={120000} loading={false} />)
    expect(screen.getByText(/\$4\.20/)).toBeInTheDocument()
  })

  it('renders request count', () => {
    render(<CostHero totalCost={4.2} requestCount={42} totalTokens={120000} loading={false} />)
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })

  it('renders token count formatted', () => {
    render(<CostHero totalCost={4.2} requestCount={42} totalTokens={120000} loading={false} />)
    expect(screen.getByText(/120\.0K|120K/)).toBeInTheDocument()
  })

  it('shows loading skeleton when loading=true', () => {
    render(<CostHero totalCost={0} requestCount={0} totalTokens={0} loading={true} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders sparkline bars when trend data provided', () => {
    const trends = [
      { timestamp: '2024-01-01', cost: 1.0, tokens: 1000, requests: 5 },
      { timestamp: '2024-01-02', cost: 2.5, tokens: 2500, requests: 10 },
      { timestamp: '2024-01-03', cost: 0.5, tokens: 500, requests: 3 },
    ]
    render(
      <CostHero totalCost={4.0} requestCount={18} totalTokens={4000} loading={false} trends={trends} />
    )
    expect(screen.getByTestId('cost-sparkline')).toBeInTheDocument()
  })
})