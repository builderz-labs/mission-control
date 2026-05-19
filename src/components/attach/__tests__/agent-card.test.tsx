import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentCard } from '../agent-card'
import type { Agent } from '@/store'

const baseAgent: Agent = {
  id: 1,
  name: 'Pepper',
  role: 'COO Assistant',
  status: 'idle',
  created_at: 1700000000,
  updated_at: 1700000000,
  config: null,
}

describe('AgentCard', () => {
  let realDateNow: () => number

  beforeEach(() => {
    realDateNow = Date.now
  })

  afterEach(() => {
    Date.now = realDateNow
  })

  it('renders agent name', () => {
    render(<AgentCard agent={baseAgent} />)
    expect(screen.getByText('Pepper')).toBeInTheDocument()
  })

  it('renders role', () => {
    render(<AgentCard agent={baseAgent} />)
    expect(screen.getByText('COO Assistant')).toBeInTheDocument()
  })

  it('shows idle status badge', () => {
    render(<AgentCard agent={baseAgent} />)
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('shows offline status badge with muted styles', () => {
    const agent = { ...baseAgent, status: 'offline' as const }
    render(<AgentCard agent={agent} />)
    const badge = screen.getByText('offline')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/muted/)
  })

  it('shows model chip when config.model.primary is set', () => {
    const agent = { ...baseAgent, config: { model: { primary: 'anthropic/claude-opus-4-5' } } }
    render(<AgentCard agent={agent} />)
    expect(screen.getByText('claude-opus-4-5')).toBeInTheDocument()
  })

  it('omits model chip when config is null', () => {
    render(<AgentCard agent={baseAgent} />)
    expect(screen.queryByText(/claude/)).not.toBeInTheDocument()
  })

  it('shows last seen relative time', () => {
    const now = 1700010000
    Date.now = vi.fn(() => now * 1000)
    const agent = { ...baseAgent, last_seen: now - 30 }
    render(<AgentCard agent={agent} />)
    expect(screen.getByText('Just now')).toBeInTheDocument()
  })

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn()
    render(<AgentCard agent={baseAgent} onClick={onClick} />)
    fireEvent.click(screen.getByText('Pepper').closest('[data-testid="agent-card"]')!)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows brand-gradient icon background when status is idle', () => {
    render(<AgentCard agent={baseAgent} />)
    const icon = screen.getByTestId('agent-icon')
    expect(icon.getAttribute('style')).toMatch(/223ED7|56308E|gradient/)
  })

  it('shows muted icon background when status is offline', () => {
    const agent = { ...baseAgent, status: 'offline' as const }
    render(<AgentCard agent={agent} />)
    const icon = screen.getByTestId('agent-icon')
    expect(icon.className).toMatch(/bg-muted/)
  })
})
