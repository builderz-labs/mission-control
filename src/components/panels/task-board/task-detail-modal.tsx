'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import type { Task, Agent, Project, Comment } from './task-board-types'
import { useMentionTargets } from './mention-textarea'
import {
  ModalHeader,
  TabBar,
  DetailsTab,
  SessionTab,
  CommentsTab,
  QualityTab,
} from './task-detail-tabs'

interface TaskDetailModalProps {
  task: Task
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onUpdate: () => void
  onEdit: (task: Task) => void
  onDelete: () => void
}

/** Full-screen modal with tabbed details, comments, quality review, and session feed. */
export function TaskDetailModal({
  task,
  agents,
  projects,
  onClose,
  onUpdate,
  onEdit,
  onDelete,
}: TaskDetailModalProps) {
  const { currentUser } = useMissionControl()
  const commentAuthor = currentUser?.username || 'system'
  const resolvedProjectName =
    task.project_name || projects.find((p) => p.id === task.project_id)?.name

  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const mentionTargets = useMentionTargets()
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality' | 'session'>('details')
  const [reviewer, setReviewer] = useState('aegis')

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/quality-review?taskId=${task.id}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Failed to fetch reviews')
      const data = await res.json()
      setReviews(data.reviews || [])
    } catch {
      setReviewError('Failed to load quality reviews')
    }
  }, [task.id])

  const fetchComments = useCallback(async () => {
    try {
      setLoadingComments(true)
      const res = await fetch(`/api/tasks/${task.id}/comments`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Failed to fetch comments')
      const data = await res.json()
      setComments(data.comments || [])
    } catch {
      setCommentError('Failed to load comments')
    } finally {
      setLoadingComments(false)
    }
  }, [task.id])

  useEffect(() => { fetchComments() }, [fetchComments])
  useEffect(() => { fetchReviews() }, [fetchReviews])
  useSmartPoll(fetchComments, 15000)

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      setCommentError(null)
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: commentAuthor || 'system', content: commentText }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error('Failed to add comment')
      setCommentText('')
      await fetchComments()
      onUpdate()
    } catch {
      setCommentError('Failed to add comment')
    }
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastMessage.trim()) return
    try {
      setBroadcastStatus(null)
      const res = await fetch(`/api/tasks/${task.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: commentAuthor || 'system', message: broadcastMessage }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Broadcast failed')
      setBroadcastMessage('')
      setBroadcastStatus(`Sent to ${data.sent || 0} subscribers`)
    } catch {
      setBroadcastStatus('Failed to broadcast')
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setReviewError(null)
      const res = await fetch('/api/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, reviewer, status: reviewStatus, notes: reviewNotes }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit review')
      setReviewNotes('')
      await fetchReviews()
      onUpdate()
    } catch {
      setReviewError('Failed to submit review')
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete task "${task.title}"? This will also remove all comments.`)) return
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Failed to delete task')
      onDelete()
      onClose()
    } catch {
      // task.deleted SSE will sync state if needed
    }
  }

  const dialogRef = useFocusTrap(onClose)

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6">
          <ModalHeader task={task} onClose={onClose} onEdit={onEdit} onDelete={handleDelete} />

          {task.description ? (
            <div className="mb-4">
              <MarkdownRenderer content={task.description} />
            </div>
          ) : (
            <p className="text-foreground/80 mb-4">No description</p>
          )}

          <TabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            hasSession={Boolean((typeof task.metadata === 'object' && task.metadata !== null && !Array.isArray(task.metadata)) ? (task.metadata as Record<string, unknown>).dispatch_session_id : undefined)}
            isLive={task.status === 'in_progress'}
          />

          {activeTab === 'details' && (
            <DetailsTab task={task} resolvedProjectName={resolvedProjectName} onViewSession={() => setActiveTab('session')} />
          )}

          {activeTab === 'comments' && (
            <CommentsTab
              comments={comments}
              loadingComments={loadingComments}
              commentText={commentText}
              commentError={commentError}
              broadcastMessage={broadcastMessage}
              broadcastStatus={broadcastStatus}
              commentAuthor={commentAuthor}
              mentionTargets={mentionTargets}
              onCommentTextChange={setCommentText}
              onBroadcastMessageChange={setBroadcastMessage}
              onAddComment={handleAddComment}
              onBroadcast={handleBroadcast}
              onRefresh={fetchComments}
            />
          )}

          {activeTab === 'quality' && (
            <QualityTab
              reviews={reviews}
              reviewer={reviewer}
              reviewStatus={reviewStatus}
              reviewNotes={reviewNotes}
              reviewError={reviewError}
              onReviewerChange={setReviewer}
              onReviewStatusChange={setReviewStatus}
              onReviewNotesChange={setReviewNotes}
              onSubmit={handleSubmitReview}
            />
          )}

          {activeTab === 'session' && <SessionTab task={task} />}
        </div>
      </div>
    </div>
  )
}
