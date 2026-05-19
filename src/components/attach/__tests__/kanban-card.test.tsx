import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KanbanCard } from '../kanban-card'

const baseTask = {
  id: 1,
  title: 'Revisar pitch Rappi',
  status: 'inbox' as const,
  priority: 'high' as const,
  assigned_to: 'Pepper',
  project_prefix: 'ATTACHMEDIA',
  project_ticket_no: 103,
  created_by: 'Fernando',
  created_at: Date.now(),
  updated_at: Date.now(),
}

describe('KanbanCard', () => {
  it('renders ticket prefix + number when both exist', () => {
    render(<KanbanCard task={baseTask} />)
    expect(screen.getByText('ATTACHMEDIA-103')).toBeInTheDocument()
  })
  it('renders task title', () => {
    render(<KanbanCard task={baseTask} />)
    expect(screen.getByText('Revisar pitch Rappi')).toBeInTheDocument()
  })
  it('shows P1 badge for high priority', () => {
    render(<KanbanCard task={baseTask} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
  })
  it('hides priority badge for low priority', () => {
    render(<KanbanCard task={{ ...baseTask, priority: 'low' }} />)
    expect(screen.queryByText('P3')).not.toBeInTheDocument()
  })
  it('shows assignee initial', () => {
    render(<KanbanCard task={baseTask} />)
    expect(screen.getByText('P')).toBeInTheDocument()  // first letter of "Pepper"
  })
  it('hides ticket when no project prefix', () => {
    render(<KanbanCard task={{ ...baseTask, project_prefix: undefined, project_ticket_no: undefined }} />)
    expect(screen.queryByText(/ATTACHMEDIA/)).not.toBeInTheDocument()
  })
})
