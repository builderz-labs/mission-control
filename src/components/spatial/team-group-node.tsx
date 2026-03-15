'use client'

import { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'

export interface TeamGroupData extends Record<string, unknown> {
  label: string
}

type TeamGroupNodeType = Node<TeamGroupData, 'team'>

export const TeamGroupNode = memo(function TeamGroupNode({ data }: NodeProps<TeamGroupNodeType>) {
  return (
    <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 min-w-[200px] min-h-[150px] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-primary/70 mb-2">
        {data.label}
      </div>
    </div>
  )
})
