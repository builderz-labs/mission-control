'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { FeedFilter, activityIcons } from './activity-feed-panel-types'

interface Agent {
  readonly name: string
  readonly status: string
}

interface ActivityFeedFiltersProps {
  readonly agents: Agent[]
  readonly selectedAgent: string
  readonly filter: FeedFilter
  readonly activityTypes: string[]
  readonly onSelectAgent: (agent: string) => void
  readonly onFilterChange: (next: FeedFilter) => void
}

/** Agent-selector + type-filter + limit-selector toolbar. */
export function ActivityFeedFilters({
  agents,
  selectedAgent,
  filter,
  activityTypes,
  onSelectAgent,
  onFilterChange,
}: ActivityFeedFiltersProps): React.JSX.Element {
  const t = useTranslations('activityFeed')

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    onFilterChange({ ...filter, type: e.target.value })
  }

  function handleLimitChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    onFilterChange({ ...filter, limit: parseInt(e.target.value, 10) })
  }

  return (
    <div className="p-4 border-b border-border bg-surface-1 flex-shrink-0">
      <div className="flex gap-4 flex-wrap items-end">

        {/* Agent filter */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t('filterAgent')}</label>
          <div className="flex gap-1 flex-wrap">
            <Button
              onClick={() => onSelectAgent('')}
              variant={selectedAgent === '' ? 'default' : 'secondary'}
              size="xs"
            >
              {t('filterAll')}
            </Button>
            {agents.map((a) => (
              <Button
                key={a.name}
                onClick={() => onSelectAgent(a.name)}
                variant={selectedAgent === a.name ? 'default' : 'secondary'}
                size="xs"
                className="flex items-center gap-1"
              >
                <AgentStatusDot status={a.status} />
                {a.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t('filterType')}</label>
          <select
            value={filter.type}
            onChange={handleTypeChange}
            className="bg-surface-2 text-foreground text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 border border-border"
          >
            <option value="">{t('allTypes')}</option>
            {activityTypes.map((type) => (
              <option key={type} value={type}>
                {activityIcons[type] ?? '•'} {type.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Limit */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t('filterLimit')}</label>
          <select
            value={filter.limit}
            onChange={handleLimitChange}
            className="bg-surface-2 text-foreground text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 border border-border"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>

      </div>
    </div>
  )
}

// Small colour dot indicating agent status
function AgentStatusDot({ status }: { readonly status: string }): React.JSX.Element {
  const colour =
    status === 'busy'
      ? 'bg-green-500'
      : status === 'idle'
        ? 'bg-yellow-500'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-muted-foreground/30'

  return <span className={`w-1.5 h-1.5 rounded-full ${colour}`} />
}
