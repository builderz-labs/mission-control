'use client'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import type { Task } from './types'
import { priorityColors, formatTaskTimestamp, getTagColor } from './types'

export interface TaskCardProps {
  task: Task
  isDragged: boolean
  agentName: string
  onDragStart: (e: React.DragEvent, task: Task) => void
  onClick: (task: Task) => void
}

export function TaskCard({ task, isDragged, agentName, onDragStart, onClick }: TaskCardProps) {
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
      className={`bg-surface-1 rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-smooth border-l-4 ${priorityColors[task.priority]} ${
        isDragged ? 'opacity-50' : ''
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <h4 className="text-foreground font-medium text-sm leading-tight">
          {task.title}
        </h4>
        <div className="flex items-center gap-2">
          {task.ticket_ref && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary">
              {task.ticket_ref}
            </span>
          )}
          {task.aegisApproved && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">
              Aegis Approved
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded font-medium ${
            task.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
            task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
            task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-green-500/20 text-green-400'
          }`}>
            {task.priority}
          </span>
        </div>
      </div>

      {task.description && (
        <div className="mb-2 line-clamp-3 overflow-hidden">
          <MarkdownRenderer content={task.description} preview />
        </div>
      )}

      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 min-w-0">
          {task.assigned_to ? (
            <>
              <AgentAvatar name={agentName} size="xs" />
              <span className="truncate">{agentName}</span>
            </>
          ) : (
            <span>Unassigned</span>
          )}
        </span>
        <span className="font-medium">{formatTaskTimestamp(task.created_at)}</span>
      </div>

      {task.project_name && (
        <div className="text-xs text-muted-foreground mt-1">
          Project: {task.project_name}
        </div>
      )}

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
  )
}
