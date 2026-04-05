'use client'

import { useTranslations } from 'next-intl'
import type { AgentReport } from './standup-types'
import { getPriorityColor } from './standup-types'

// WHY: Per-agent report card is the most complex repeating element in the standup
//      view — isolating it here keeps the parent file readable and allows
//      independent iteration on layout without touching other sections.

interface TaskListProps {
  readonly items: Array<{ id: number; title: string }>
  readonly emptyLabel: string
}

function TaskList({ items, emptyLabel }: TaskListProps): React.ReactElement {
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground/50 italic">{emptyLabel}</div>
  }
  return (
    <div className="space-y-1">
      {items.map(task => (
        <div key={task.id} className="text-sm text-foreground/80 truncate" title={task.title}>
          {task.title}
        </div>
      ))}
    </div>
  )
}

interface PriorityTaskListProps {
  readonly items: Array<{ id: number; title: string; priority: string }>
  readonly emptyLabel: string
}

function PriorityTaskList({ items, emptyLabel }: PriorityTaskListProps): React.ReactElement {
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground/50 italic">{emptyLabel}</div>
  }
  return (
    <div className="space-y-1">
      {items.map(task => (
        <div key={task.id} className="text-sm text-foreground/80">
          <div className="truncate" title={task.title}>{task.title}</div>
          <div className={`text-xs ${getPriorityColor(task.priority)}`}>
            [{task.priority}]
          </div>
        </div>
      ))}
    </div>
  )
}

interface StandupAgentReportProps {
  readonly report: AgentReport
}

export function StandupAgentReport({ report }: StandupAgentReportProps): React.ReactElement {
  const t = useTranslations('standup')
  const { agent, completedToday, inProgress, assigned, blocked, activity } = report

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h5 className="font-semibold text-foreground">{agent.name}</h5>
          <p className="text-muted-foreground text-sm">{agent.role}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-muted-foreground">
            {t('activitySummary', { actions: activity.actionCount, comments: activity.commentsCount })}
          </div>
          {agent.last_activity && (
            <div className="text-muted-foreground/50">{agent.last_activity}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <h6 className="text-green-400 font-medium mb-2">
            ✅ {t('sectionCompleted', { count: completedToday.length })}
          </h6>
          <TaskList items={completedToday} emptyLabel={t('none')} />
        </div>

        <div>
          <h6 className="text-yellow-400 font-medium mb-2">
            🔄 {t('sectionInProgress', { count: inProgress.length })}
          </h6>
          <TaskList items={inProgress} emptyLabel={t('none')} />
        </div>

        <div>
          <h6 className="text-blue-400 font-medium mb-2">
            📋 {t('sectionAssigned', { count: assigned.length })}
          </h6>
          <PriorityTaskList items={assigned} emptyLabel={t('none')} />
        </div>

        <div>
          <h6 className="text-red-400 font-medium mb-2">
            🚫 {t('sectionBlocked', { count: blocked.length })}
          </h6>
          <PriorityTaskList items={blocked} emptyLabel={t('none')} />
        </div>
      </div>
    </div>
  )
}
