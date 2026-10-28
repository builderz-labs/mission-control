import { describe, it, expect } from 'vitest'

// Test the Project interface shape and store defaults
// We import types only to verify the interface matches expectations

describe('Project store types', () => {
  it('Project interface supports enhanced fields', () => {
    // This is a compile-time check — if the interface is wrong, this file won't compile
    const project: import('@/store').Project = {
      id: 1,
      name: 'Test Project',
      slug: 'test-project',
      ticket_prefix: 'TP',
      status: 'active',
      group_name: 'InHaus',
      description: 'A test project',
      github_repo: 'owner/repo',
      deadline: 1893456000,
      color: '#3b82f6',
      task_count: 5,
      assigned_agents: ['agent-1', 'agent-2'],
    }

    expect(project.github_repo).toBe('owner/repo')
    expect(project.group_name).toBe('InHaus')
    expect(project.deadline).toBe(1893456000)
    expect(project.color).toBe('#3b82f6')
    expect(project.task_count).toBe(5)
    expect(project.assigned_agents).toEqual(['agent-1', 'agent-2'])
  })

  it('Project interface allows optional enhanced fields', () => {
    const project: import('@/store').Project = {
      id: 2,
      name: 'Minimal',
      slug: 'minimal',
      ticket_prefix: 'MIN',
      status: 'active',
    }

    expect(project.github_repo).toBeUndefined()
    expect(project.group_name).toBeUndefined()
    expect(project.deadline).toBeUndefined()
    expect(project.color).toBeUndefined()
    expect(project.task_count).toBeUndefined()
    expect(project.assigned_agents).toBeUndefined()
  })
})
