'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import type { Agent } from './agent-detail-types'

const log = createClientLogger('ActivityTab')

interface ActivityTabProps {
  agent: Agent
}

function getActivityIcon(type: string): string {
  switch (type) {
    case 'agent_status_change': return '~'
    case 'task_created': return '+'
    case 'task_updated': return '>'
    case 'comment_added': return '#'
    case 'agent_heartbeat': return '*'
    case 'agent_soul_updated': return '@'
    case 'agent_memory_updated': return '='
    default: return '.'
  }
}

export function ActivityTab({ agent }: ActivityTabProps) {
  const t = useTranslations('agentDetail')
  const [activities, setActivities] = useState<Array<{ id: number; type: string; description: string; created_at: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const fetchActivities = async () => {
      try {
        const response = await fetch(`/api/activities?actor=${agent.name}&limit=50`, { signal: controller.signal })
        if (response.ok) {
          const data = await response.json()
          setActivities(data.activities || [])
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') log.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
    return () => controller.abort()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-8">
        <Loader variant="inline" label={t('loadingActivity')} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-foreground">{t('recentActivity')}</h4>

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h8M2 12h10" />
            </svg>
          </div>
          <p className="text-sm">{t('noRecentActivity')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(activity => (
            <div key={activity.id} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{getActivityIcon(activity.type)}</div>
                <div className="flex-1">
                  <p className="text-foreground">{activity.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{activity.type}</span>
                    <span>•</span>
                    <span>{new Date(activity.created_at * 1000).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
