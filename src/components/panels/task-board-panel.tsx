'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMissionControl } from '@/store'

interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
  aegisApproved?: boolean
}

interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
}

const statusColumns = [
  { key: 'inbox', title: 'Inbox', color: 'bg-gray-700' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-700' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-700' },
  { key: 'review', title: 'Review', color: 'bg-purple-700' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-700' },
  { key: 'done', title: 'Done', color: 'bg-green-700' },
]

const priorityColors = {
  low: 'border-green-500',
  medium: 'border-yellow-500',
  high: 'border-orange-500',
  urgent: 'border-red-500',
}

export function TaskBoardPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const dragCounter = useRef(0)

  // Fetch tasks and agents
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [tasksResponse, agentsResponse] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents')
      ])

      if (!tasksResponse.ok || !agentsResponse.ok) {
        throw new Error('Failed to fetch data')
      }

      const tasksData = await tasksResponse.json()
      const agentsData = await agentsResponse.json()

      const tasksList = tasksData.tasks || []
      const taskIds = tasksList.map((task: Task) => task.id)

      let aegisMap: Record<number, boolean> = {}
      if (taskIds.length > 0) {
        try {
          const reviewResponse = await fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          if (reviewResponse.ok) {
            const reviewData = await reviewResponse.json()
            const latest = reviewData.latest || {}
            aegisMap = Object.fromEntries(
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved'
              ])
            )
          }
        } catch (error) {
          aegisMap = {}
        }
      }

      setTasks(
        tasksList.map((task: Task) => ({
          ...task,
          aegisApproved: Boolean(aegisMap[task.id])
        }))
      )
      setAgents(agentsData.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Group tasks by status
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>)

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML)
  }

  const handleDragEnter = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    dragCounter.current++
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    dragCounter.current--
    if (dragCounter.current === 0) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    dragCounter.current = 0
    e.currentTarget.classList.remove('drag-over')

    if (!draggedTask || draggedTask.status === newStatus) {
      setDraggedTask(null)
      return
    }

    try {
      if (newStatus === 'done') {
        const reviewResponse = await fetch(`/api/quality-review?taskId=${draggedTask.id}`)
        if (!reviewResponse.ok) {
          throw new Error('Unable to verify Aegis approval')
        }
        const reviewData = await reviewResponse.json()
        const latest = reviewData.reviews?.find((review: any) => review.reviewer === 'aegis')
        if (!latest || latest.status !== 'approved') {
          throw new Error('Aegis approval is required before moving to done')
        }
      }

      // Optimistically update UI
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: newStatus as Task['status'], updated_at: Math.floor(Date.now() / 1000) }
            : task
        )
      )

      // Update on server
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [{ id: draggedTask.id, status: newStatus }]
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update task status')
      }
    } catch (err) {
      // Revert optimistic update
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: draggedTask.status }
            : task
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to update task status')
    } finally {
      setDraggedTask(null)
    }
  }

  // Format relative time for tasks
  const formatTaskTimestamp = (timestamp: number) => {
    const now = new Date().getTime()
    const time = new Date(timestamp * 1000).getTime()
    const diff = now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'just now'
  }

  const getTagColor = (tag: string) => {
    const lowerTag = tag.toLowerCase()
    if (lowerTag.includes('urgent') || lowerTag.includes('critical')) {
      return 'bg-red-500/20 text-red-400 border-red-500/30'
    }
    if (lowerTag.includes('bug') || lowerTag.includes('fix')) {
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    }
    if (lowerTag.includes('feature') || lowerTag.includes('enhancement')) {
      return 'bg-green-500/20 text-green-400 border-green-500/30'
    }
    if (lowerTag.includes('research') || lowerTag.includes('analysis')) {
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    }
    if (lowerTag.includes('deploy') || lowerTag.includes('release')) {
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    }
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }

  // Get agent name by session key
  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-400">Loading tasks...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Task Board</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            + New Task
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Refresh
          </button>
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

      {/* Kanban Board */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {statusColumns.map(column => (
          <div
            key={column.key}
            className="flex-1 min-w-80 bg-gray-800 rounded-lg flex flex-col"
            onDragEnter={(e) => handleDragEnter(e, column.key)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.key)}
          >
            {/* Column Header */}
            <div className={`${column.color} text-white p-3 rounded-t-lg flex justify-between items-center`}>
              <h3 className="font-semibold">{column.title}</h3>
              <span className="text-sm bg-black/20 px-2 py-1 rounded">
                {tasksByStatus[column.key]?.length || 0}
              </span>
            </div>

            {/* Column Body */}
            <div className="flex-1 p-3 space-y-3 min-h-32">
              {tasksByStatus[column.key]?.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task)}
                  onClick={() => setSelectedTask(task)}
                  className={`bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-600 transition-colors border-l-4 ${priorityColors[task.priority]} ${
                    draggedTask?.id === task.id ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-white font-medium text-sm leading-tight">
                      {task.title}
                    </h4>
                    <div className="flex items-center gap-2">
                      {task.aegisApproved && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">
                          Aegis Approved
                        </span>
                      )}
                      <span className={`text-xs px-2 py-1 rounded ${
                        task.priority === 'urgent' ? 'bg-red-600 text-white' :
                        task.priority === 'high' ? 'bg-orange-600 text-white' :
                        task.priority === 'medium' ? 'bg-yellow-600 text-black' :
                        'bg-green-600 text-white'
                      }`}>
                        {task.priority}
                      </span>
                    </div>
                  </div>
                  
                  {task.description && (
                    <p className="text-gray-300 text-xs mb-2 line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{getAgentName(task.assigned_to)}</span>
                    <span className="font-medium">{formatTaskTimestamp(task.created_at)}</span>
                  </div>

                  {task.tags && task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.tags.slice(0, 3).map((tag, index) => (
                        <span
                          key={index}
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="text-muted-foreground text-xs font-medium">+{task.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Enhanced timestamp display */}
                  {task.updated_at && task.updated_at !== task.created_at && (
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      Updated {formatTaskTimestamp(task.updated_at)}
                    </div>
                  )}

                  {task.due_date && (
                    <div className="mt-2 text-xs">
                      <span className={`${
                        task.due_date * 1000 < Date.now() ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        Due: {formatTaskTimestamp(task.due_date)}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Empty State */}
              {tasksByStatus[column.key]?.length === 0 && (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No tasks in {column.title.toLowerCase()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTask(null)}
          onUpdate={fetchData}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          agents={agents}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchData}
        />
      )}
    </div>
  )
}

// Task Detail Modal Component (placeholder - would be implemented separately)
function TaskDetailModal({ 
  task, 
  agents, 
  onClose, 
  onUpdate 
}: { 
  task: Task
  agents: Agent[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('system')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality'>('details')
  const [reviewer, setReviewer] = useState('aegis')

  const fetchReviews = useCallback(async () => {
    try {
      const response = await fetch(`/api/quality-review?taskId=${task.id}`)
      if (!response.ok) throw new Error('Failed to fetch reviews')
      const data = await response.json()
      setReviews(data.reviews || [])
    } catch (error) {
      setReviewError('Failed to load quality reviews')
    }
  }, [task.id])

  const fetchComments = useCallback(async () => {
    try {
      setLoadingComments(true)
      const response = await fetch(`/api/tasks/${task.id}/comments`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      setComments(data.comments || [])
    } catch (error) {
      setCommentError('Failed to load comments')
    } finally {
      setLoadingComments(false)
    }
  }, [task.id])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])
  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])
  
  useEffect(() => {
    const interval = setInterval(fetchComments, 5000)
    return () => clearInterval(interval)
  }, [fetchComments])

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return

    try {
      setCommentError(null)
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          content: commentText
        })
      })
      if (!response.ok) throw new Error('Failed to add comment')
      setCommentText('')
      await fetchComments()
      onUpdate()
    } catch (error) {
      setCommentError('Failed to add comment')
    }
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastMessage.trim()) return

    try {
      setBroadcastStatus(null)
      const response = await fetch(`/api/tasks/${task.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          message: broadcastMessage
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Broadcast failed')
      setBroadcastMessage('')
      setBroadcastStatus(`Sent to ${data.sent || 0} subscribers`)
    } catch (error) {
      setBroadcastStatus('Failed to broadcast')
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setReviewError(null)
      const response = await fetch('/api/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          reviewer,
          status: reviewStatus,
          notes: reviewNotes
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit review')
      setReviewNotes('')
      await fetchReviews()
      onUpdate()
    } catch (error) {
      setReviewError('Failed to submit review')
    }
  }

  const renderComment = (comment: Comment, depth: number = 0) => (
    <div key={comment.id} className={`border-l-2 border-gray-700 pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="font-medium text-gray-300">{comment.author}</span>
        <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
      </div>
      <div className="text-sm text-gray-200 mt-1 whitespace-pre-wrap">{comment.content}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-bold text-white">{task.title}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              ×
            </button>
          </div>
          <p className="text-gray-300 mb-4">{task.description || 'No description'}</p>
          <div className="flex gap-2 mt-4">
            {(['details', 'comments', 'quality'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm rounded ${
                  activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                }`}
              >
                {tab === 'details' ? 'Details' : tab === 'comments' ? 'Comments' : 'Quality Review'}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className="grid grid-cols-2 gap-4 text-sm mt-4">
              <div>
                <span className="text-gray-400">Status:</span>
                <span className="text-white ml-2">{task.status}</span>
              </div>
              <div>
                <span className="text-gray-400">Priority:</span>
                <span className="text-white ml-2">{task.priority}</span>
              </div>
              <div>
                <span className="text-gray-400">Assigned to:</span>
                <span className="text-white ml-2">{task.assigned_to || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-gray-400">Created:</span>
                <span className="text-white ml-2">{new Date(task.created_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-white">Comments</h4>
              <button
                onClick={fetchComments}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Refresh
              </button>
            </div>

            {commentError && (
              <div className="bg-red-900/20 border border-red-500 text-red-400 p-2 rounded text-sm mb-3">
                {commentError}
              </div>
            )}

            {loadingComments ? (
              <div className="text-gray-400 text-sm">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-gray-500 text-sm">No comments yet.</div>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Author</label>
                <input
                  type="text"
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">New Comment</label>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                >
                  Add Comment
                </button>
              </div>
            </form>

            <div className="mt-6 border-t border-gray-700 pt-4">
              <h5 className="text-sm font-semibold text-white mb-2">Broadcast to Subscribers</h5>
              {broadcastStatus && (
                <div className="text-xs text-gray-400 mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <textarea
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Send a message to all task subscribers..."
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors text-xs"
                  >
                    Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>
          )}

          {activeTab === 'quality' && (
            <div className="mt-6">
              <h5 className="text-sm font-semibold text-white mb-2">Aegis Quality Review</h5>
              {reviewError && (
                <div className="text-xs text-red-400 mb-2">{reviewError}</div>
              )}
              {reviews.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {reviews.map((review) => (
                    <div key={review.id} className="text-xs text-gray-300 bg-gray-700/40 rounded p-2">
                      <div className="flex justify-between">
                        <span>{review.reviewer} — {review.status}</span>
                        <span>{new Date(review.created_at * 1000).toLocaleString()}</span>
                      </div>
                      {review.notes && <div className="mt-1">{review.notes}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-400 mb-3">No reviews yet.</div>
              )}
              <form onSubmit={handleSubmitReview} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="bg-gray-700 text-white rounded px-2 py-1 text-xs"
                    placeholder="Reviewer (e.g., aegis)"
                  />
                  <select
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value as 'approved' | 'rejected')}
                    className="bg-gray-700 text-white rounded px-2 py-1 text-xs"
                  >
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                  </select>
                  <input
                    type="text"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs"
                    placeholder="Review notes (required)"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-green-600 text-white rounded text-xs"
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Create Task Modal Component (placeholder)
function CreateTaskModal({ 
  agents, 
  onClose, 
  onCreated 
}: { 
  agents: Agent[]
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    assigned_to: '',
    tags: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined
        })
      })

      if (!response.ok) throw new Error('Failed to create task')
      
      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating task:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">Create New Task</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">Assign to</label>
                <select
                  value={formData.assigned_to}
                  onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Unassigned</option>
                  {agents.map(agent => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name} ({agent.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="frontend, urgent, bug"
              />
            </div>
          </div>
          
          <div className="flex gap-3 mt-6">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Create Task
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-600 text-white py-2 rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
