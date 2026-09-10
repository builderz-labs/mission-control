import { describe, expect, it } from 'vitest'
import { groupProjects, normalizedProjectGroup, projectGroupIdentity, UNGROUPED_PROJECT_GROUP } from '@/lib/project-groups'

describe('groupProjects', () => {
  it('keeps ungrouped projects visible and sorts named groups', () => {
    const result = groupProjects([
      { name: 'Worker', group_name: 'InHaus' },
      { name: 'Notes', group_name: 'Personal' },
      { name: 'General', group_name: null },
      { name: 'API', group_name: 'InHaus' },
    ])

    expect(result.ungrouped.map((project) => project.name)).toEqual(['General'])
    expect(result.groups.map((group) => group.name)).toEqual(['InHaus', 'Personal'])
    expect(result.groups[0].projects.map((project) => project.name)).toEqual(['API', 'Worker'])
  })

  it('treats blank legacy values as ungrouped', () => {
    const result = groupProjects([{ name: 'Legacy', group_name: '   ' }])
    expect(result.ungrouped).toHaveLength(1)
    expect(result.groups).toHaveLength(0)
  })

  it('normalizes task group labels and exposes the ungrouped filter value', () => {
    expect(normalizedProjectGroup('  Platform  ')).toBe('Platform')
    expect(normalizedProjectGroup('   ')).toBeNull()
    expect(UNGROUPED_PROJECT_GROUP).toBe('__ungrouped__')
  })

  it('keeps a real sentinel-named group distinct from ungrouped tasks', () => {
    const named = projectGroupIdentity('__ungrouped__')
    const missing = projectGroupIdentity(null)

    expect(named).toEqual({ key: 'group:__ungrouped__', name: '__ungrouped__', isUngrouped: false })
    expect(missing).toEqual({ key: UNGROUPED_PROJECT_GROUP, name: null, isUngrouped: true })
    expect(named.key).not.toBe(missing.key)
  })
})
