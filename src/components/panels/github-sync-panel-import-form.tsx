'use client'

import { Button } from '@/components/ui/button'

interface ImportFormProps {
  repo: string
  labelFilter: string
  stateFilter: 'open' | 'closed' | 'all'
  assignAgent: string
  agents: Array<{ name: string }>
  previewing: boolean
  syncing: boolean
  onRepoChange: (value: string) => void
  onLabelFilterChange: (value: string) => void
  onStateFilterChange: (value: 'open' | 'closed' | 'all') => void
  onAssignAgentChange: (value: string) => void
  onPreview: () => void
  onImport: () => void
}

export function ImportIssuesForm({
  repo,
  labelFilter,
  stateFilter,
  assignAgent,
  agents,
  previewing,
  syncing,
  onRepoChange,
  onLabelFilterChange,
  onStateFilterChange,
  onAssignAgentChange,
  onPreview,
  onImport,
}: ImportFormProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">Import Issues</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Repository</label>
            <input
              type="text"
              value={repo}
              onChange={e => onRepoChange(e.target.value)}
              placeholder="owner/repo"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Labels (optional)</label>
            <input
              type="text"
              value={labelFilter}
              onChange={e => onLabelFilterChange(e.target.value)}
              placeholder="bug,enhancement"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">State</label>
            <select
              value={stateFilter}
              onChange={e => onStateFilterChange(e.target.value as 'open' | 'closed' | 'all')}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Assign to Agent (optional)</label>
            <select
              value={assignAgent}
              onChange={e => onAssignAgentChange(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Unassigned</option>
              {agents.map(a => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={onPreview}
            disabled={previewing || !repo}
            variant="outline"
            size="xs"
            className="flex items-center gap-1.5"
          >
            {previewing ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3 3" />
              </svg>
            )}
            Preview
          </Button>
          <Button
            onClick={onImport}
            disabled={syncing || !repo}
            size="xs"
            className={`flex items-center gap-1.5 ${
              !repo ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''
            }`}
          >
            {syncing ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8M5 7l3 3 3-3" />
                <path d="M3 12v2h10v-2" />
              </svg>
            )}
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}
