'use client'

import type { Project } from '@/store'

export function JevRepositoryScope({
  projects, selected, onChange,
}: {
  projects: Project[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const selectedSet = new Set(selected)
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
      <legend className="px-1 text-xs font-medium text-foreground">Choose repositories</legend>
      <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
        {projects.map((project) => (
          <label key={project.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50">
            <input type="checkbox" className="mt-0.5" checked={selectedSet.has(project.id)} onChange={(event) => onChange(event.target.checked ? [...selected, project.id] : selected.filter((id) => id !== project.id))} />
            <span><strong className="text-foreground">{project.name}</strong>{project.github_repo && <span className="block font-mono text-[10px]">{project.github_repo}</span>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
