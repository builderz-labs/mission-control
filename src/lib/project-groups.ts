export interface GroupableProject {
  name: string
  group_name?: string | null
}

export interface ProjectGroup<T> {
  name: string
  projects: T[]
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

export function groupProjects<T extends GroupableProject>(projects: T[]): {
  ungrouped: T[]
  groups: ProjectGroup<T>[]
} {
  const ungrouped: T[] = []
  const grouped = new Map<string, T[]>()

  for (const project of projects) {
    const groupName = project.group_name?.trim()
    if (!groupName) {
      ungrouped.push(project)
      continue
    }
    const current = grouped.get(groupName) || []
    current.push(project)
    grouped.set(groupName, current)
  }

  ungrouped.sort((a, b) => compareNames(a.name, b.name))
  const groups = Array.from(grouped, ([name, groupedProjects]) => ({
    name,
    projects: groupedProjects.sort((a, b) => compareNames(a.name, b.name)),
  })).sort((a, b) => compareNames(a.name, b.name))

  return { ungrouped, groups }
}
