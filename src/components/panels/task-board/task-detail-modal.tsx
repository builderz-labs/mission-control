'use client'

import { useState, useCallback, useEffect } from 'react'
import { useMissionControl, type Agent } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import type { Task, Comment, Project } from './types'
import { MentionTextarea, useMentionTargets } from './mention-textarea'

export interface TaskDetailModalProps {
  task: Task
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onUpdate: () => void
  onEdit: (task: Task) => void
}

export function TaskDetailModal({
  task,
  agents,
  projects,
  onClose,
  onUpdate,
  onEdit
}: TaskDetailModalProps) {
  const { currentUser } = useMissionControl()
  const commentAuthor = currentUser?.username || 'system'
  const resolvedProjectName =
    task.project_name ||
    projects.find((project) => project.id === task.project_id)?.name
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const mentionTargets = useMentionTargets()
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

  useSmartPoll(fetchComments, 15000)

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
    <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{comment.author}</span>
        <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
      </div>
      <div className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{comment.content}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  )

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 id="task-detail-title" className="text-xl font-bold text-foreground">{task.title}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(task)}
                className="px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded-md transition-smooth text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={onClose}
                aria-label="Close task details"
                className="text-muted-foreground hover:text-foreground text-2xl transition-smooth"
              >
                ×
              </button>
            </div>
          </div>
          {task.description ? (
            <div className="mb-4">
              <MarkdownRenderer content={task.description} />
            </div>
          ) : (
            <p className="text-foreground/80 mb-4">No description</p>
          )}
          <div className="flex gap-2 mt-4" role="tablist" aria-label="Task detail tabs">
            {(['details', 'comments', 'quality'] as const).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`tabpanel-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm rounded-md transition-smooth ${
                  activeTab === tab ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'
                }`}
              >
                {tab === 'details' ? 'Details' : tab === 'comments' ? 'Comments' : 'Quality Review'}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div id="tabpanel-details" role="tabpanel" aria-label="Details" className="grid grid-cols-2 gap-4 text-sm mt-4">
              {task.ticket_ref && (
                <div>
                  <span className="text-muted-foreground">Ticket:</span>
                  <span className="text-foreground ml-2 font-mono">{task.ticket_ref}</span>
                </div>
              )}
              {resolvedProjectName && (
                <div>
                  <span className="text-muted-foreground">Project:</span>
                  <span className="text-foreground ml-2">{resolvedProjectName}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Status:</span>
                <span className="text-foreground ml-2">{task.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Priority:</span>
                <span className="text-foreground ml-2">{task.priority}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Assigned to:</span>
                <span className="text-foreground ml-2 inline-flex items-center gap-1.5">
                  {task.assigned_to ? (
                    <>
                      <AgentAvatar name={task.assigned_to} size="xs" />
                      <span>{task.assigned_to}</span>
                    </>
                  ) : (
                    <span>Unassigned</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <span className="text-foreground ml-2">{new Date(task.created_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div id="tabpanel-comments" role="tabpanel" aria-label="Comments" className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-foreground">Comments</h4>
              <button
                onClick={fetchComments}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Refresh
              </button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-sm mb-3">
                {commentError}
              </div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-sm">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/50 text-sm">No comments yet.</div>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Posting as</span>
                <span className="font-medium text-foreground">{commentAuthor}</span>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">New Comment</label>
                <MentionTextarea
                  value={commentText}
                  onChange={setCommentText}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={3}
                  mentionTargets={mentionTargets}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Use <span className="font-mono">@</span> to mention users and agents.</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-sm"
                >
                  Add Comment
                </button>
              </div>
            </form>

            <div className="mt-5 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-blue-300">How notifications work</div>
              <div><strong className="text-foreground">Comments</strong> are persisted on the task and notify all subscribers. Subscribers are auto-added when they: create the task, are assigned to it, comment on it, or are @mentioned.</div>
              <div><strong className="text-foreground">Broadcasts</strong> send a one-time notification to all current subscribers without creating a comment record.</div>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Broadcast to Subscribers</h5>
              {broadcastStatus && (
                <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <MentionTextarea
                  value={broadcastMessage}
                  onChange={setBroadcastMessage}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={2}
                  placeholder="Send a message to all task subscribers... (use @ to mention)"
                  mentionTargets={mentionTargets}
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-md hover:bg-purple-500/30 transition-smooth text-xs"
                  >
                    Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>
          )}

          {activeTab === 'quality' && (
            <div id="tabpanel-quality" role="tabpanel" aria-label="Quality Review" className="mt-6">
              <h5 className="text-sm font-medium text-foreground mb-2">Aegis Quality Review</h5>
              {reviewError && (
                <div className="text-xs text-red-400 mb-2">{reviewError}</div>
              )}
              {reviews.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {reviews.map((review) => (
                    <div key={review.id} className="text-xs text-foreground/80 bg-surface-1/40 rounded p-2">
                      <div className="flex justify-between">
                        <span>{review.reviewer} — {review.status}</span>
                        <span>{new Date(review.created_at * 1000).toLocaleString()}</span>
                      </div>
                      {review.notes && <div className="mt-1">{review.notes}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mb-3">No reviews yet.</div>
              )}
              <form onSubmit={handleSubmitReview} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Reviewer (e.g., aegis)"
                  />
                  <select
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value as 'approved' | 'rejected')}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                  >
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                  </select>
                  <input
                    type="text"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Review notes (required)"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md text-xs"
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
