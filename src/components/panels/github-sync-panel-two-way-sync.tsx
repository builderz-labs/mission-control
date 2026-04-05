'use client'

import { Button } from '@/components/ui/button'
import type { Project } from './github-sync-panel-types'

interface TwoWaySyncProps {
  projects: Project[]
  syncingProjectId: number | null
  onToggleSync: (project: Project) => void
  onSyncProject: (projectId: number) => void
  onSyncAll: () => void
}

function SyncIcon(): React.JSX.Element {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 8a6 6 0 0110.472-4M14 8a6 6 0 01-10.472 4" />
      <path d="M13 2v4h-4M3 14v-4h4" />
    </svg>
  )
}

interface ProjectRowProps {
  project: Project
  syncingProjectId: number | null
  onToggleSync: (project: Project) => void
  onSyncProject: (projectId: number) => void
}

function ProjectRow({ project, syncingProjectId, onToggleSync, onSyncProject }: ProjectRowProps): React.JSX.Element {
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${
          project.github_sync_enabled ? 'bg-green-500' : 'bg-muted-foreground/30'
        }`} />
        <div>
          <div className="text-sm text-foreground">{project.name}</div>
          <div className="text-xs text-muted-foreground font-mono">{project.github_repo}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => onToggleSync(project)}
          className="text-xs"
        >
          {project.github_sync_enabled ? 'Disable' : 'Enable'}
        </Button>
        {project.github_sync_enabled && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onSyncProject(project.id)}
            disabled={syncingProjectId === project.id}
            className="flex items-center gap-1.5"
          >
            {syncingProjectId === project.id ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <SyncIcon />
            )}
            Sync
          </Button>
        )}
      </div>
    </div>
  )
}

export function TwoWaySyncSection({
  projects,
  syncingProjectId,
  onToggleSync,
  onSyncProject,
  onSyncAll,
}: TwoWaySyncProps): React.JSX.Element {
  const linkedProjects = projects.filter(p => p.github_repo)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Two-Way Sync</h3>
        <Button
          variant="outline"
          size="xs"
          onClick={onSyncAll}
          disabled={syncingProjectId !== null}
          className="flex items-center gap-1.5"
        >
          Sync All
        </Button>
      </div>
      <div className="divide-y divide-border/50">
        {linkedProjects.map(project => (
          <ProjectRow
            key={project.id}
            project={project}
            syncingProjectId={syncingProjectId}
            onToggleSync={onToggleSync}
            onSyncProject={onSyncProject}
          />
        ))}
        {linkedProjects.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No projects linked to GitHub repos. Set a GitHub repo in Project Management.
          </div>
        )}
      </div>
    </div>
  )
}
