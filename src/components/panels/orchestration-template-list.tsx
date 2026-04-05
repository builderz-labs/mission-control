'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { WorkflowTemplate } from './orchestration-bar.types'

interface TemplateListProps {
  filteredTemplates: WorkflowTemplate[]
  expandedId: number | null
  spawning: number | null
  onToggleExpand: (id: number) => void
  onExecute: (template: WorkflowTemplate) => void
  onEdit: (template: WorkflowTemplate) => void
  onDuplicate: (template: WorkflowTemplate) => void
  onDelete: (id: number) => void
}

export function TemplateList({
  filteredTemplates,
  expandedId,
  spawning,
  onToggleExpand,
  onExecute,
  onEdit,
  onDuplicate,
  onDelete,
}: TemplateListProps): React.ReactElement {
  const t = useTranslations('orchestration')

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {filteredTemplates.map(tmpl => (
        <div key={tmpl.id} className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
          <div className="flex items-center gap-2 p-2">
            <Button
              variant="ghost"
              onClick={() => onToggleExpand(tmpl.id)}
              className="flex-1 min-w-0 text-left h-auto p-0 rounded-none"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{tmpl.name}</span>
                <span className="text-2xs text-muted-foreground font-mono">{tmpl.model}</span>
                {tmpl.use_count > 0 && (
                  <span className="text-2xs text-muted-foreground">{tmpl.use_count}x</span>
                )}
                {(tmpl.tags || []).map(tag => (
                  <span key={tag} className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground">{tag}</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground truncate">{tmpl.description || tmpl.task_prompt}</p>
            </Button>
            <TemplateActions
              template={tmpl}
              spawning={spawning}
              onExecute={onExecute}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </div>
          {expandedId === tmpl.id && (
            <TemplateDetail template={tmpl} t={t} />
          )}
        </div>
      ))}
    </div>
  )
}

interface TemplateActionsProps {
  template: WorkflowTemplate
  spawning: number | null
  onExecute: (template: WorkflowTemplate) => void
  onEdit: (template: WorkflowTemplate) => void
  onDuplicate: (template: WorkflowTemplate) => void
  onDelete: (id: number) => void
}

function TemplateActions({
  template,
  spawning,
  onExecute,
  onEdit,
  onDuplicate,
  onDelete,
}: TemplateActionsProps): React.ReactElement {
  return (
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
      <Button
        onClick={() => onExecute(template)}
        disabled={spawning === template.id}
        size="xs"
        title="Run"
      >
        {spawning === template.id ? '...' : 'Run'}
      </Button>
      <Button onClick={() => onEdit(template)} variant="secondary" size="icon-xs" title="Edit">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      <Button onClick={() => onDuplicate(template)} variant="secondary" size="icon-xs" title="Duplicate">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <rect x="5" y="5" width="9" height="9" rx="1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 11V3a1 1 0 011-1h8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      <Button onClick={() => onDelete(template.id)} variant="destructive" size="icon-xs" title="Delete">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </Button>
    </div>
  )
}

interface TemplateDetailProps {
  template: WorkflowTemplate
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string) => string
}

function TemplateDetail({ template, t }: TemplateDetailProps): React.ReactElement {
  const timeoutLabel = template.timeout_seconds < 60
    ? `${template.timeout_seconds}s`
    : `${Math.round(template.timeout_seconds / 60)}m`

  return (
    <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2">
      <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono bg-secondary/50 rounded p-2 max-h-32 overflow-y-auto">
        {template.task_prompt}
      </pre>
      <div className="flex items-center gap-3 mt-2 text-2xs text-muted-foreground">
        <span>{t('timeout')}: {timeoutLabel}</span>
        {template.agent_role && <span>{t('role')}: {template.agent_role}</span>}
        {template.last_used_at && (
          <span>{t('lastRun')}: {new Date(template.last_used_at * 1000).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  )
}
