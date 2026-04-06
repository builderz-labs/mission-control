'use client'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import type { Task, Agent } from './task-board-types'
import { priorityColors, formatTaskTimestamp, getTagColor, getAgentName } from './task-board-utils'

interface TaskCardProps {
  task: Task
  agents: Agent[]
  isDragging: boolean
  onDragStart: (e: React.DragEvent, task: Task) => void
  onClick: (task: Task) => void
}

/** Individual kanban card representing a single task. */
export function TaskCard({ task, agents, isDragging, onDragStart, onClick }: TaskCardProps) {
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-label={`${task.title}, ${task.priority} priority, ${task.status}`}
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onClick(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(task)
        }
      }}
      className={`group bg-card rounded-lg p-3 cursor-pointer border border-border/40 shadow-sm hover:shadow-md hover:shadow-black/10 hover:border-border/70 transition-all duration-200 ease-out border-l-4 ${priorityColors[task.priority]} ${
        isDragging ? 'opacity-40 scale-[0.97] rotate-1' : ''
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      {/* Drag handle + Title row */}
      <div className="flex items-start gap-2 mb-2">
        <svg
          className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors shrink-0 cursor-grab"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <h4 className="text-foreground font-medium text-sm leading-tight line-clamp-2">
              {task.title}
            </h4>
            <TaskBadges task={task} />
          </div>
        </div>
      </div>

      {task.description && (
        <div className="mb-2 ml-5.5 line-clamp-2 overflow-hidden text-xs text-muted-foreground">
          <MarkdownRenderer content={task.description} preview />
        </div>
      )}

      {/* Footer: assignee, priority, timestamp */}
      <div className="flex items-center justify-between gap-2 ml-5.5 mt-auto pt-2 border-t border-border/20">
        <span className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
          {task.assigned_to ? (
            <>
              <AgentAvatar name={getAgentName(agents, task.assigned_to)} size="xs" />
              <span className="truncate max-w-[8rem]">
                {getAgentName(agents, task.assigned_to)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground/50 italic">Unassigned</span>
          )}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              task.priority === 'critical'
                ? 'bg-red-500/20 text-red-400'
                : task.priority === 'high'
                ? 'bg-orange-500/20 text-orange-400'
                : task.priority === 'medium'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-green-500/20 text-green-400'
            }`}
          >
            {task.priority}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatTaskTimestamp(task.created_at)}
          </span>
        </div>
      </div>

      {/* Tags row */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 ml-5.5">
          {task.tags.slice(0, 3).map((tag, index) => (
            <span
              key={index}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-muted-foreground/60 text-[10px]">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Due date — prominent when overdue */}
      {task.due_date && (
        <div className="mt-1.5 ml-5.5 text-[10px]">
          <span
            className={`inline-flex items-center gap-1 ${
              task.due_date * 1000 < Date.now()
                ? 'text-red-400 font-medium'
                : 'text-muted-foreground/60'
            }`}
          >
            {task.due_date * 1000 < Date.now() ? '!' : ''} Due{' '}
            {formatTaskTimestamp(task.due_date)}
          </span>
        </div>
      )}
    </div>
  )
}

/** Inline badge cluster in the top-right of a card: recurrence, ticket ref, GitHub links, Aegis. */
function TaskBadges({ task }: { task: Task }) {
  const metaObj = (typeof task.metadata === 'object' && task.metadata !== null && !Array.isArray(task.metadata))
    ? task.metadata as Record<string, unknown>
    : null
  const recurrence = (typeof metaObj?.recurrence === 'object' && metaObj?.recurrence !== null && !Array.isArray(metaObj?.recurrence))
    ? metaObj.recurrence as Record<string, unknown>
    : null
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {!!recurrence?.enabled && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono"
          title={(recurrence.natural_text as string | undefined) || (recurrence.cron_expr as string | undefined)}
        >
          RECURRING
        </span>
      )}
      {!!recurrence?.parent_task_id && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400/70 font-mono"
          title={`Spawned from task #${recurrence.parent_task_id}`}
        >
          SPAWNED
        </span>
      )}
      {task.ticket_ref && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono">
          {task.ticket_ref}
        </span>
      )}
      {task.github_issue_number && task.github_repo && (
        <a
          href={`https://github.com/${task.github_repo}/issues/${task.github_issue_number}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] px-1.5 py-0.5 rounded bg-[#24292e]/30 text-gray-300 hover:text-white font-mono flex items-center gap-1 transition-colors"
          onClick={(e) => e.stopPropagation()}
          title={`GitHub issue #${task.github_issue_number}`}
        >
          <GitHubIcon />
          #{task.github_issue_number}
        </a>
      )}
      {task.github_pr_number && task.github_repo && (
        <a
          href={`https://github.com/${task.github_repo}/pull/${task.github_pr_number}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1 transition-colors ${
            task.github_pr_state === 'merged'
              ? 'bg-purple-500/20 text-purple-400'
              : task.github_pr_state === 'closed'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-green-500/20 text-green-400'
          }`}
          onClick={(e) => e.stopPropagation()}
          title={`PR #${task.github_pr_number} (${task.github_pr_state || 'open'})`}
        >
          <PullRequestIcon />
          PR #{task.github_pr_number}
        </a>
      )}
      {task.aegisApproved && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          Aegis
        </span>
      )}
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function PullRequestIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
    </svg>
  )
}
