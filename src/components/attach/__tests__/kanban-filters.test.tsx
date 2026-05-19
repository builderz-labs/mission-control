import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KanbanFilters } from '../kanban-filters'

const baseFilters = { assignee: undefined, priority: undefined, project: undefined, search: '' }

describe('KanbanFilters', () => {
  it('renders search input', () => {
    render(<KanbanFilters filters={baseFilters} groupBy="status" onFiltersChange={() => {}} onGroupByChange={() => {}} agents={[]} projects={[]} />)
    expect(screen.getByPlaceholderText(/Buscar/i)).toBeInTheDocument()
  })

  it('shows chip when assignee filter active', () => {
    render(<KanbanFilters filters={{ ...baseFilters, assignee: 'Pepper' }} groupBy="status" onFiltersChange={() => {}} onGroupByChange={() => {}} agents={[{ id: 'Pepper', name: 'Pepper' }]} projects={[]} />)
    expect(screen.getByText(/Assignee: Pepper/)).toBeInTheDocument()
  })

  it('calls onFiltersChange with cleared assignee when chip X clicked', () => {
    const onChange = vi.fn()
    render(<KanbanFilters filters={{ ...baseFilters, assignee: 'Pepper' }} groupBy="status" onFiltersChange={onChange} onGroupByChange={() => {}} agents={[{ id: 'Pepper', name: 'Pepper' }]} projects={[]} />)
    fireEvent.click(screen.getByLabelText('Remove filter Assignee'))
    expect(onChange).toHaveBeenCalledWith({ ...baseFilters, assignee: undefined })
  })

  it('calls onFiltersChange with all cleared when Limpiar filtros clicked', () => {
    const onChange = vi.fn()
    render(<KanbanFilters filters={{ ...baseFilters, assignee: 'Pepper', priority: 'high' }} groupBy="status" onFiltersChange={onChange} onGroupByChange={() => {}} agents={[{ id: 'Pepper', name: 'Pepper' }]} projects={[]} />)
    fireEvent.click(screen.getByText(/Limpiar filtros/))
    expect(onChange).toHaveBeenCalledWith(baseFilters)
  })
})