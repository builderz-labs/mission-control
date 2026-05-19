import { describe, it, expect } from 'vitest'
import { applyFilters, groupTasks } from '../use-kanban-filters'

const tasks = [
  { id: 1, title: 'Brief comercial Galileo', status: 'inbox', assigned_to: 'Pepper', priority: 'critical', project_prefix: 'GALILEO', description: '' },
  { id: 2, title: 'Pitch Rappi', status: 'in_progress', assigned_to: 'Pepper', priority: 'high', project_prefix: 'ATTACHMEDIA', description: '' },
  { id: 3, title: 'Onboarding cliente', status: 'review', assigned_to: 'Knox', priority: 'medium', project_prefix: 'PROSPECTIA', description: 'follow-up needed' },
] as const

describe('applyFilters', () => {
  it('returns all tasks when no filters', () => {
    expect(applyFilters(tasks as any, { search: '' })).toHaveLength(3)
  })
  it('filters by assignee', () => {
    expect(applyFilters(tasks as any, { assignee: 'Pepper', search: '' })).toHaveLength(2)
  })
  it('filters by project prefix', () => {
    expect(applyFilters(tasks as any, { project: 'GALILEO', search: '' })).toHaveLength(1)
  })
  it('filters by priority', () => {
    expect(applyFilters(tasks as any, { priority: 'critical', search: '' })).toHaveLength(1)
  })
  it('full-text search matches title', () => {
    expect(applyFilters(tasks as any, { search: 'rappi' })).toHaveLength(1)
  })
  it('full-text search matches description', () => {
    expect(applyFilters(tasks as any, { search: 'follow-up' })).toHaveLength(1)
  })
  it('combines filters with AND', () => {
    expect(applyFilters(tasks as any, { assignee: 'Pepper', priority: 'critical', search: '' })).toHaveLength(1)
  })
})

describe('groupTasks', () => {
  it('groups by status', () => {
    const groups = groupTasks(tasks as any, 'status')
    expect(groups['inbox']).toHaveLength(1)
    expect(groups['in_progress']).toHaveLength(1)
    expect(groups['review']).toHaveLength(1)
  })
  it('groups by agent', () => {
    const groups = groupTasks(tasks as any, 'agent')
    expect(groups['Pepper']).toHaveLength(2)
    expect(groups['Knox']).toHaveLength(1)
  })
  it('groups by project', () => {
    const groups = groupTasks(tasks as any, 'project')
    expect(groups['GALILEO']).toHaveLength(1)
  })
})