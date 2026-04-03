'use client'

import type { Task, Agent, StatusColumn } from './task-board-types'
import { TaskCard } from './task-card'

interface TaskColumnProps {
  column: StatusColumn
  tasks: Task[]
  agents: Agent[]
  draggedTaskId: number | null
  onDragStart: (e: React.DragEvent, task: Task) => void
  onDragEnter: (e: React.DragEvent, status: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, status: string) => void
  onTaskClick: (task: Task) => void
}

/** A single kanban column with its header, card list, and drop-zone behaviour. */
export function TaskColumn({
  column,
  tasks,
  agents,
  draggedTaskId,
  onDragStart,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onTaskClick,
}: TaskColumnProps) {
  return (
    <div
      role="region"
      aria-label={`${column.title} column, ${tasks.length} tasks`}
      className="flex-1 min-w-80 bg-surface-0 border border-border/60 rounded-xl flex flex-col transition-colors duration-200 [&.drag-over]:border-primary/40 [&.drag-over]:bg-primary/[0.02]"
      onDragEnter={(e) => onDragEnter(e, column.key)}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, column.key)}
    >
      {/* Column Header */}
      <div
        className={`${column.color} px-4 py-3 rounded-t-xl flex justify-between items-center border-b border-border/30`}
      >
        <h3 className="font-semibold text-sm tracking-wide">{column.title}</h3>
        <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded-md min-w-[1.75rem] text-center">
          {tasks.length}
        </span>
      </div>

      {/* Column Body */}
      <div className="flex-1 p-2.5 space-y-2.5 min-h-32 overflow-y-auto">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            agents={agents}
            isDragging={draggedTaskId === task.id}
            onDragStart={onDragStart}
            onClick={onTaskClick}
          />
        ))}

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/30">
            <svg
              className="w-8 h-8 mb-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 12h6M12 9v6" strokeLinecap="round" />
            </svg>
            <span className="text-xs">Drop tasks here</span>
          </div>
        )}
      </div>
    </div>
  )
}
