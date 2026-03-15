'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { AgentNodeData } from '@/store/canvas-store'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-emerald-500',
  offline: 'bg-gray-500',
  busy: 'bg-amber-500',
  error: 'bg-red-500',
}

type AgentNodeType = Node<AgentNodeData, 'agent'>

export const AgentNodeComponent = memo(function AgentNodeComponent({ data, selected }: NodeProps<AgentNodeType>) {
  return (
    <div
      className={cn(
        'px-4 py-3 rounded-xl border bg-card/90 backdrop-blur-sm shadow-lg min-w-[160px] transition-all',
        selected ? 'ring-2 ring-primary border-primary' : 'border-border/50'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary/50 !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1">
        <div
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0',
            STATUS_COLORS[data.status] ?? 'bg-gray-500'
          )}
        />
        <span className="font-semibold text-sm truncate">{data.label}</span>
      </div>
      {data.role && (
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
          {data.role}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-primary/50 !w-2 !h-2" />
    </div>
  )
})
