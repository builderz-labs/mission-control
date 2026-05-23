'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'

interface CoreNodeData {
  label: string
  agentCount: number
}

/**
 * Central CORE orchestration node for the agent network graph.
 * Pulsing concentric cyan rings — the visual identity of Mission Control.
 */
function AgentCoreNodeInner({ data }: NodeProps & { data: CoreNodeData }) {
  const { label = 'CORE', agentCount = 0 } = data ?? {}

  return (
    <div className="relative flex items-center justify-center w-[120px] h-[120px]">
      {/* Outer ring — slowest pulse */}
      <div className="absolute inset-0 rounded-full border border-void-cyan/20 animate-[edgeGlow_3s_ease-in-out_infinite]" />

      {/* Middle ring */}
      <div className="absolute inset-3 rounded-full border border-void-cyan/30 animate-[edgeGlow_2.5s_ease-in-out_infinite_0.4s]" />

      {/* Inner ring */}
      <div className="absolute inset-6 rounded-full border border-void-cyan/40 animate-[edgeGlow_2s_ease-in-out_infinite_0.8s]" />

      {/* Core circle */}
      <div className="relative z-10 size-16 rounded-full bg-card border-2 border-void-cyan glow-cyan flex flex-col items-center justify-center">
        <span className="font-mono text-xs font-bold tracking-widest text-void-cyan">
          {label}
        </span>
        {agentCount > 0 && (
          <span className="font-mono text-[10px] text-void-cyan/70 mt-0.5">
            {agentCount}
          </span>
        )}
      </div>
    </div>
  )
}

export const AgentCoreNode = memo(AgentCoreNodeInner)
