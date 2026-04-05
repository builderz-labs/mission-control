'use client'

import { useTranslations } from 'next-intl'
import { Activity, activityIcons, activityColors, formatRelativeTime } from './activity-feed-panel-types'

// ── Flat-feed row ────────────────────────────────────────────────────────────
export function ActivityRow({ activity }: { readonly activity: Activity }): React.JSX.Element {
  const t = useTranslations('activityFeed')

  const iconBg =
    (activityColors[activity.type]?.replace('text-', 'bg-').replace('-400', '-500/15') ?? 'bg-surface-2')

  return (
    <div className="bg-card rounded-lg p-3 border-l-2 border-border hover:bg-surface-1 transition-smooth">
      <div className="flex items-start gap-3">
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${iconBg} ${activityColors[activity.type] ?? 'text-muted-foreground'}`}
        >
          {activityIcons[activity.type] ?? '•'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-foreground text-sm">
                <span className="font-medium text-primary">{activity.actor}</span>{' '}
                <span className={activityColors[activity.type] ?? 'text-muted-foreground'}>
                  {activity.description}
                </span>
              </p>

              {activity.entity && <EntityPreview activity={activity} />}

              {activity.data && Object.keys(activity.data).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">
                    {t('showDetails')}
                  </summary>
                  <pre className="mt-1 text-xs text-muted-foreground bg-surface-1 p-2 rounded-md overflow-auto max-h-32 border border-border/50">
                    {JSON.stringify(activity.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex-shrink-0 text-[10px] text-muted-foreground/50">
              {formatRelativeTime(activity.created_at)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Inline sub-component — extracted to keep ActivityRow under 50 lines
function EntityPreview({ activity }: { readonly activity: Activity }): React.JSX.Element | null {
  const t = useTranslations('activityFeed')
  const { entity } = activity
  if (!entity) return null

  return (
    <div className="mt-2 p-2 bg-surface-1 rounded-md text-xs border border-border/50">
      {entity.type === 'task' && (
        <div>
          <span className="text-muted-foreground">{t('entityTask')}</span>
          <span className="text-foreground ml-1">{entity.title}</span>
          {entity.status && (
            <span className="ml-2 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
              {entity.status}
            </span>
          )}
        </div>
      )}
      {entity.type === 'comment' && (
        <div>
          <span className="text-muted-foreground">{t('entityCommentOn')}</span>
          <span className="text-foreground ml-1">{entity.task_title}</span>
          {entity.content_preview && (
            <div className="mt-1 text-muted-foreground/70 italic">
              &quot;{entity.content_preview}...&quot;
            </div>
          )}
        </div>
      )}
      {entity.type === 'agent' && (
        <div>
          <span className="text-muted-foreground">{t('entityAgent')}</span>
          <span className="text-foreground ml-1">{entity.name}</span>
          {entity.status && (
            <span className="ml-2 px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded text-[10px]">
              {entity.status}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Timeline row (agent-grouped view) ────────────────────────────────────────
export function TimelineRow({ activity }: { readonly activity: Activity }): React.JSX.Element {
  const dotBorder =
    activity.type === 'agent_status_change'
      ? 'border-yellow-400'
      : activity.type.startsWith('task')
        ? 'border-blue-400'
        : 'border-muted-foreground'

  return (
    <div className="flex items-start gap-2.5 pl-3 py-1.5 hover:bg-secondary/30 rounded-r-lg transition-smooth relative">
      <span
        className={`absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-card border-2 ${dotBorder}`}
      />
      <span
        className={`w-5 h-5 rounded bg-secondary flex items-center justify-center text-2xs font-mono font-bold shrink-0 ${activityColors[activity.type] ?? 'text-muted-foreground'}`}
      >
        {activityIcons[activity.type] ?? '?'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground">{activity.description}</p>
        {activity.entity?.title && (
          <p className="text-2xs text-muted-foreground mt-0.5 truncate">
            {activity.entity.title}
          </p>
        )}
      </div>
      <span className="text-2xs text-muted-foreground font-mono-tight shrink-0">
        {new Date(activity.created_at * 1000).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  )
}
