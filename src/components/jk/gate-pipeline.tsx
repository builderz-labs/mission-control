'use client'

import type { GateStatus } from '@/lib/jk/approval-queue'

const GATE_LABELS: Record<number, string> = {
  1: 'Strategi Bulanan',
  2: 'CEP Selection',
  3: 'Content Brief',
  4: 'Content Execution',
}

interface Props {
  gates: GateStatus[]
}

export function GatePipeline({ gates }: Props) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {gates.map((gate, i) => (
        <div key={gate.gate_number} className="flex items-center">
          <div className="flex flex-col items-center min-w-[110px]">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold border-2 ${statusStyle(gate.status)}`}>
              {statusIcon(gate.status)}
            </div>
            <div className="text-xs text-center mt-1 leading-tight text-neutral-400 max-w-[100px]">
              <span className="font-medium text-neutral-300">Gate {gate.gate_number}</span>
              <br />
              {GATE_LABELS[gate.gate_number]}
            </div>
            {gate.item_count > 0 && gate.status === 'pending' && (
              <span className="text-xs text-amber-400 mt-0.5">{gate.item_count} pending</span>
            )}
          </div>
          {i < gates.length - 1 && (
            <div className={`h-px w-8 mx-1 flex-shrink-0 ${gate.status === 'approved' ? 'bg-green-500' : 'bg-neutral-600'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function statusStyle(status: GateStatus['status']): string {
  switch (status) {
    case 'approved': return 'border-green-500 bg-green-500/20 text-green-400'
    case 'pending':  return 'border-amber-400 bg-amber-400/20 text-amber-400'
    case 'locked':   return 'border-neutral-600 bg-neutral-800 text-neutral-500'
    case 'empty':    return 'border-neutral-500 bg-neutral-700/50 text-neutral-400'
  }
}

function statusIcon(status: GateStatus['status']): string {
  switch (status) {
    case 'approved': return '✓'
    case 'pending':  return '⏳'
    case 'locked':   return '🔒'
    case 'empty':    return '○'
  }
}
