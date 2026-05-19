import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardHero } from '../dashboard-hero'

describe('DashboardHero', () => {
  it('renders greeting with user name', () => {
    render(<DashboardHero userName="Fernando" activeAgents={5} reviewTasks={3} dailySpend={4.20} />)
    expect(screen.getByText(/Fernando/)).toBeInTheDocument()
  })

  it('renders active agents count', () => {
    render(<DashboardHero userName="Fernando" activeAgents={5} reviewTasks={3} dailySpend={4.20} />)
    expect(screen.getByText(/5 agentes activos/)).toBeInTheDocument()
  })

  it('renders review tasks count', () => {
    render(<DashboardHero userName="Fernando" activeAgents={5} reviewTasks={3} dailySpend={4.20} />)
    expect(screen.getByText(/3 tareas en review/)).toBeInTheDocument()
  })

  it('formats daily spend as USD', () => {
    render(<DashboardHero userName="Fernando" activeAgents={5} reviewTasks={3} dailySpend={4.20} />)
    expect(screen.getByText(/\$4\.20/)).toBeInTheDocument()
  })
})