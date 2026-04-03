'use client'

import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import type { Task } from './task-board-types'
import { TaskSessionFeed } from './task-session-feed'

export type { CommentsTabProps } from './task-comments-tab'
export { CommentsTab } from './task-comments-tab'

// ─── ModalHeader ─────────────────────────────────────────────────────────────

export function ModalHeader({
  task,
  onClose,
  onEdit,
  onDelete,
}: {
  task: Task
  onClose: () => void
  onEdit: (task: Task) => void
  onDelete: () => void
}) {
  return (
    <div className="flex justify-between items-start mb-4">
      <h3 id="task-detail-title" className="text-xl font-bold text-foreground">
        {task.title}
      </h3>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => onEdit(task)} className="text-primary hover:bg-primary/20">
          Edit
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close task details" className="text-xl">
          ×
        </Button>
      </div>
    </div>
  )
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

export function TabBar({
  activeTab,
  onTabChange,
  hasSession,
  isLive,
}: {
  activeTab: string
  onTabChange: (tab: 'details' | 'comments' | 'quality' | 'session') => void
  hasSession: boolean
  isLive: boolean
}) {
  return (
    <div className="flex gap-2 mt-4" role="tablist" aria-label="Task detail tabs">
      {(['details', 'comments', 'quality'] as const).map((tab) => (
        <Button
          key={tab}
          role="tab"
          size="sm"
          variant={activeTab === tab ? 'default' : 'secondary'}
          aria-selected={activeTab === tab}
          aria-controls={`tabpanel-${tab}`}
          onClick={() => onTabChange(tab)}
        >
          {tab === 'details' ? 'Details' : tab === 'comments' ? 'Comments' : 'Quality Review'}
        </Button>
      ))}
      {hasSession && (
        <Button
          role="tab"
          size="sm"
          variant={activeTab === 'session' ? 'default' : 'secondary'}
          aria-selected={activeTab === 'session'}
          aria-controls="tabpanel-session"
          onClick={() => onTabChange('session')}
        >
          Session
          {isLive && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          )}
        </Button>
      )}
    </div>
  )
}

// ─── DetailsTab ───────────────────────────────────────────────────────────────

export function DetailsTab({
  task,
  resolvedProjectName,
  onViewSession,
}: {
  task: Task
  resolvedProjectName?: string
  onViewSession: () => void
}) {
  return (
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
        <span className="text-foreground ml-2">
          {new Date(task.created_at * 1000).toLocaleDateString()}
        </span>
      </div>
      <GitHubSection task={task} />
      <SessionSection task={task} onViewSession={onViewSession} />
    </div>
  )
}

function GitHubSection({ task }: { task: Task }) {
  if (!task.github_issue_number && !task.github_branch && !task.github_pr_number) return null
  return (
    <>
      <div className="col-span-2 mt-2 pt-2 border-t border-border/50">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">GitHub</span>
      </div>
      {task.github_issue_number && task.github_repo && (
        <div>
          <span className="text-muted-foreground">Issue:</span>
          <a
            href={`https://github.com/${task.github_repo}/issues/${task.github_issue_number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline ml-2 font-mono"
          >
            {task.github_repo}#{task.github_issue_number}
          </a>
        </div>
      )}
      {task.github_branch && (
        <div>
          <span className="text-muted-foreground">Branch:</span>
          <span className="text-foreground ml-2 font-mono text-xs">{task.github_branch}</span>
        </div>
      )}
      {task.github_pr_number && task.github_repo && (
        <div>
          <span className="text-muted-foreground">PR:</span>
          <a
            href={`https://github.com/${task.github_repo}/pull/${task.github_pr_number}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`ml-2 font-mono hover:underline ${
              task.github_pr_state === 'merged'
                ? 'text-purple-400'
                : task.github_pr_state === 'closed'
                ? 'text-red-400'
                : 'text-green-400'
            }`}
          >
            #{task.github_pr_number} ({task.github_pr_state || 'open'})
          </a>
        </div>
      )}
    </>
  )
}

function SessionSection({ task, onViewSession }: { task: Task; onViewSession: () => void }) {
  if (!task.metadata?.dispatch_session_id) return null
  return (
    <>
      <div className="col-span-2 mt-2 pt-2 border-t border-border/50">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Agent Session</span>
      </div>
      <div className="col-span-2">
        <Button variant="secondary" size="sm" onClick={onViewSession} className="font-mono text-xs">
          View Session {task.metadata.dispatch_session_id.slice(0, 8)}...
        </Button>
        {task.status === 'in_progress' && (
          <span className="ml-2 text-xs text-green-400 animate-pulse">Live</span>
        )}
      </div>
    </>
  )
}

// ─── SessionTab ───────────────────────────────────────────────────────────────

export function SessionTab({ task }: { task: Task }) {
  if (!task.metadata?.dispatch_session_id) return null
  return (
    <div id="tabpanel-session" role="tabpanel" aria-label="Session" className="mt-4">
      <TaskSessionFeed
        sessionId={task.metadata.dispatch_session_id}
        agentName={task.assigned_to}
        isLive={task.status === 'in_progress'}
      />
    </div>
  )
}

// ─── QualityTab ───────────────────────────────────────────────────────────────

export interface QualityTabProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reviews: any[]
  reviewer: string
  reviewStatus: 'approved' | 'rejected'
  reviewNotes: string
  reviewError: string | null
  onReviewerChange: (v: string) => void
  onReviewStatusChange: (v: 'approved' | 'rejected') => void
  onReviewNotesChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
}

export function QualityTab({
  reviews,
  reviewer,
  reviewStatus,
  reviewNotes,
  reviewError,
  onReviewerChange,
  onReviewStatusChange,
  onReviewNotesChange,
  onSubmit,
}: QualityTabProps) {
  return (
    <div id="tabpanel-quality" role="tabpanel" aria-label="Quality Review" className="mt-6">
      <h5 className="text-sm font-medium text-foreground mb-2">Aegis Quality Review</h5>
      {reviewError && <div className="text-xs text-red-400 mb-2">{reviewError}</div>}
      {reviews.length > 0 ? (
        <div className="space-y-2 mb-3">
          {reviews.map((review) => (
            <div key={review.id} className="text-xs text-foreground/80 bg-surface-1/40 rounded p-2">
              <div className="flex justify-between">
                <span>
                  {review.reviewer} — {review.status}
                </span>
                <span>{new Date(review.created_at * 1000).toLocaleString()}</span>
              </div>
              {review.notes && <div className="mt-1">{review.notes}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground mb-3">No reviews yet.</div>
      )}
      <form onSubmit={onSubmit} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={reviewer}
            onChange={(e) => onReviewerChange(e.target.value)}
            className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
            placeholder="Reviewer (e.g., aegis)"
          />
          <select
            value={reviewStatus}
            onChange={(e) => onReviewStatusChange(e.target.value as 'approved' | 'rejected')}
            className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
          >
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
          <input
            type="text"
            value={reviewNotes}
            onChange={(e) => onReviewNotesChange(e.target.value)}
            className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
            placeholder="Review notes (required)"
          />
          <Button type="submit" variant="success" size="xs">
            Submit
          </Button>
        </div>
      </form>
    </div>
  )
}
