'use client'

import type { Task } from './types'
import { TaskCard } from './task-card'

export interface BoardColumnProps {
  columnKey: string
  title: string
  color: string
  tasks: Task[]
  draggedTaskId: number | null
  getAgentName: (sessionKey?: string) => string
  onDragStart: (e: React.DragEvent, task: Task) => void
  onDragEnter: (e: React.DragEvent, status: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, newStatus: string) => void
  onTaskClick: (task: Task) => void
}

export function BoardColumn({
  columnKey,
  title,
  color,
  tasks,
  draggedTaskId,
  getAgentName,
  onDragStart,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onTaskClick,
}: BoardColumnProps) {
  return (
    <div
      role="region"
      aria-label={`${title} column, ${tasks.length} tasks`}
      className="flex-1 min-w-80 bg-card border border-border rounded-lg flex flex-col"
      onDragEnter={(e) => onDragEnter(e, columnKey)}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, columnKey)}
    >
      <div className={`${color} p-3 rounded-t-lg flex justify-between items-center`}>
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm bg-black/20 px-2 py-1 rounded">
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 p-3 space-y-3 min-h-32">
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            isDragged={draggedTaskId === task.id}
            agentName={getAgentName(task.assigned_to)}
            onDragStart={onDragStart}
            onClick={onTaskClick}
          />
        ))}

        {tasks.length === 0 && (
          <div className="text-center text-muted-foreground/50 py-8 text-sm">
            No tasks in {title.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  )
}
