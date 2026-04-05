'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { SchedulerTask } from './webhook-types'
import { formatWebhookTime } from './webhook-types'

// WHY: Local-mode automation tasks are a distinct feature orthogonal to webhook
//      CRUD — isolating them makes it easy to hide the section behind the
//      isLocalMode flag without cluttering the parent render.

interface WebhookAutomationsProps {
  readonly tasks: SchedulerTask[]
  readonly runningAutomationId: string | null
  readonly onRun: (taskId: string) => void
}

export function WebhookAutomations({ tasks, runningAutomationId, onRun }: WebhookAutomationsProps): React.ReactElement | null {
  const t = useTranslations('webhooks')
  if (tasks.length === 0) return null

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
      <h3 className="text-sm font-semibold text-cyan-200">{t('localAutomations')}</h3>
      <p className="text-2xs text-cyan-300/80 mt-0.5 mb-2">{t('localAutomationsDesc')}</p>
      <div className="space-y-2">
        {tasks.map((task) => (
          <AutomationRow
            key={task.id}
            task={task}
            isRunning={runningAutomationId === task.id}
            onRun={onRun}
          />
        ))}
      </div>
    </div>
  )
}

interface AutomationRowProps {
  readonly task: SchedulerTask
  readonly isRunning: boolean
  readonly onRun: (taskId: string) => void
}

function AutomationRow({ task, isRunning, onRun }: AutomationRowProps): React.ReactElement {
  const t = useTranslations('webhooks')
  const dotClass = task.running
    ? 'bg-blue-400'
    : task.enabled
      ? 'bg-green-500'
      : 'bg-muted-foreground/40'

  const nextRunLabel = task.nextRun
    ? t('nextRun', { time: formatWebhookTime(task.nextRun / 1000) })
    : t('noNextRun')

  return (
    <div className="rounded border border-cyan-500/20 bg-background/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${dotClass}`} />
            <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-300 font-mono">{task.id}</span>
          </div>
          <div className="text-2xs text-muted-foreground mt-1">
            {nextRunLabel}
            {task.lastResult?.message ? ` · ${task.lastResult.message}` : ''}
          </div>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onRun(task.id)}
          disabled={isRunning}
          className="text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 text-2xs"
        >
          {isRunning ? t('running') : t('run')}
        </Button>
      </div>
    </div>
  )
}
