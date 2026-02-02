'use client'

import { useState, useEffect, useCallback } from 'react'

interface Activity {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data?: any
  created_at: number
  entity?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
}

const activityIcons: Record<string, string> = {
  task_created: '📝',
  task_updated: '✏️',
  task_deleted: '🗑️',
  comment_added: '💬',
  agent_created: '🤖',
  agent_status_change: '🔄',
  standup_generated: '📊',
  mention: '📢',
  assignment: '👤',
}

const activityColors: Record<string, string> = {
  task_created: 'text-green-400',
  task_updated: 'text-blue-400',
  task_deleted: 'text-red-400',
  comment_added: 'text-purple-400',
  agent_created: 'text-cyan-400',
  agent_status_change: 'text-yellow-400',
  standup_generated: 'text-orange-400',
  mention: 'text-pink-400',
  assignment: 'text-indigo-400',
}

export function ActivityFeedPanel() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filter, setFilter] = useState({
    type: '',
    actor: '',
    limit: 50
  })
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  // Fetch activities
  const fetchActivities = useCallback(async (since?: number) => {
    try {
      if (!since) setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (filter.type) params.append('type', filter.type)
      if (filter.actor) params.append('actor', filter.actor)
      if (filter.limit) params.append('limit', filter.limit.toString())
      if (since) params.append('since', Math.floor(since / 1000).toString())

      const response = await fetch(`/api/activities?${params}`)
      if (!response.ok) throw new Error('Failed to fetch activities')

      const data = await response.json()
      
      if (since) {
        // For real-time updates, prepend new activities
        setActivities(prev => {
          const newActivities = data.activities || []
          const existingIds = new Set(prev.map((a: Activity) => a.id))
          const uniqueNew = newActivities.filter((a: Activity) => !existingIds.has(a.id))
          return [...uniqueNew, ...prev].slice(0, filter.limit)
        })
      } else {
        // For initial load or manual refresh, replace all
        setActivities(data.activities || [])
      }

      setLastRefresh(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [filter])

  // Initial load
  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  // Auto-refresh for real-time updates
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchActivities(lastRefresh)
    }, 5000) // Check every 5 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, fetchActivities, lastRefresh])

  // Format relative time
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Get unique activity types for filter
  const activityTypes = Array.from(new Set(activities.map(a => a.type))).sort()
  const actors = Array.from(new Set(activities.map(a => a.actor))).sort()

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Activity Feed</h2>
          <div className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-green-500' : 'bg-gray-500'} animate-pulse`}></div>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              autoRefresh 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => fetchActivities()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-gray-700 bg-gray-800">
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Activity Type</label>
            <select
              value={filter.type}
              onChange={(e) => setFilter(prev => ({ ...prev, type: e.target.value }))}
              className="bg-gray-700 text-white text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              {activityTypes.map(type => (
                <option key={type} value={type}>
                  {activityIcons[type] || '•'} {type.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Actor</label>
            <select
              value={filter.actor}
              onChange={(e) => setFilter(prev => ({ ...prev, actor: e.target.value }))}
              className="bg-gray-700 text-white text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actors</option>
              {actors.map(actor => (
                <option key={actor} value={actor}>{actor}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Limit</label>
            <select
              value={filter.limit}
              onChange={(e) => setFilter(prev => ({ ...prev, limit: parseInt(e.target.value) }))}
              className="bg-gray-700 text-white text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={25}>25 items</option>
              <option value={50}>50 items</option>
              <option value={100}>100 items</option>
              <option value={200}>200 items</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Activity List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-gray-400">Loading activities...</span>
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">📭</div>
            <p>No activities found</p>
            <p className="text-sm">Try adjusting your filters or refresh the feed</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity, index) => (
              <div
                key={`${activity.id}-${index}`}
                className="bg-gray-800 rounded-lg p-4 border-l-4 border-gray-600 hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Activity Icon */}
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-lg">
                    {activityIcons[activity.type] || '•'}
                  </div>

                  {/* Activity Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-white text-sm">
                          <span className="font-medium text-blue-400">{activity.actor}</span>
                          {' '}
                          <span className={activityColors[activity.type] || 'text-gray-300'}>
                            {activity.description}
                          </span>
                        </p>
                        
                        {/* Entity Details */}
                        {activity.entity && (
                          <div className="mt-2 p-2 bg-gray-700/50 rounded text-xs">
                            {activity.entity.type === 'task' && (
                              <div>
                                <span className="text-gray-400">Task:</span>
                                <span className="text-white ml-1">{activity.entity.title}</span>
                                {activity.entity.status && (
                                  <span className="ml-2 px-2 py-1 bg-blue-600/20 text-blue-300 rounded">
                                    {activity.entity.status}
                                  </span>
                                )}
                              </div>
                            )}
                            
                            {activity.entity.type === 'comment' && (
                              <div>
                                <span className="text-gray-400">Comment on:</span>
                                <span className="text-white ml-1">{activity.entity.task_title}</span>
                                {activity.entity.content_preview && (
                                  <div className="mt-1 text-gray-300 italic">
                                    "{activity.entity.content_preview}..."
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {activity.entity.type === 'agent' && (
                              <div>
                                <span className="text-gray-400">Agent:</span>
                                <span className="text-white ml-1">{activity.entity.name}</span>
                                {activity.entity.status && (
                                  <span className="ml-2 px-2 py-1 bg-green-600/20 text-green-300 rounded">
                                    {activity.entity.status}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Additional Data */}
                        {activity.data && Object.keys(activity.data).length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                              Show details
                            </summary>
                            <pre className="mt-1 text-xs text-gray-300 bg-gray-700/30 p-2 rounded overflow-auto max-h-32">
                              {JSON.stringify(activity.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                      
                      {/* Timestamp */}
                      <div className="flex-shrink-0 text-xs text-gray-500">
                        {formatRelativeTime(activity.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="border-t border-gray-700 p-3 bg-gray-800 text-xs text-gray-400">
        <div className="flex justify-between items-center">
          <span>
            Showing {activities.length} activities
            {filter.type || filter.actor ? ' (filtered)' : ''}
          </span>
          <span>
            Last updated: {new Date(lastRefresh).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}