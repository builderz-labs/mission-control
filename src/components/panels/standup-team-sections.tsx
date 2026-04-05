'use client'

import { useTranslations } from 'next-intl'
import type { TeamAccomplishment, TeamBlocker, OverdueTask } from './standup-types'
import { getPriorityColor } from './standup-types'

// WHY: Team-level sections are visually distinct from per-agent cards and
//      change independently — keeping them in a separate file reduces diff noise.

interface TeamAccomplishmentsProps {
  readonly accomplishments: TeamAccomplishment[]
}

export function TeamAccomplishments({ accomplishments }: TeamAccomplishmentsProps): React.ReactElement | null {
  const t = useTranslations('standup')
  if (accomplishments.length === 0) return null

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <h4 className="text-lg font-semibold text-foreground mb-3">🎉 {t('teamAccomplishments')}</h4>
      <div className="space-y-2">
        {accomplishments.map(task => (
          <div key={task.id} className="flex justify-between items-center p-2 bg-green-900/20 rounded border-l-4 border-green-500">
            <span className="text-foreground">{task.title}</span>
            <span className="text-green-400 text-sm">{task.agent}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface TeamBlockersProps {
  readonly blockers: TeamBlocker[]
}

export function TeamBlockers({ blockers }: TeamBlockersProps): React.ReactElement | null {
  const t = useTranslations('standup')
  if (blockers.length === 0) return null

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <h4 className="text-lg font-semibold text-foreground mb-3">🚫 {t('teamBlockers')}</h4>
      <div className="space-y-2">
        {blockers.map(task => (
          <div key={task.id} className="flex justify-between items-center p-2 bg-red-900/20 rounded border-l-4 border-red-500">
            <div>
              <span className="text-foreground">{task.title}</span>
              <span className={`ml-2 text-sm ${getPriorityColor(task.priority)}`}>
                [{task.priority.toUpperCase()}]
              </span>
            </div>
            <span className="text-red-400 text-sm">{task.agent}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface OverdueTasksProps {
  readonly tasks: OverdueTask[]
}

export function OverdueTasks({ tasks }: OverdueTasksProps): React.ReactElement | null {
  const t = useTranslations('standup')
  if (tasks.length === 0) return null

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <h4 className="text-lg font-semibold text-foreground mb-3">⏰ {t('overdueTasks')}</h4>
      <div className="space-y-2">
        {tasks.map(task => (
          <div key={task.id} className="flex justify-between items-center p-2 bg-orange-900/20 rounded border-l-4 border-orange-500">
            <div>
              <span className="text-foreground">{task.title}</span>
              <span className="text-orange-400 text-sm ml-2">
                (Due: {new Date(task.due_date * 1000).toLocaleDateString()})
              </span>
            </div>
            <span className="text-orange-400 text-sm">{task.agent_name || t('unassigned')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
