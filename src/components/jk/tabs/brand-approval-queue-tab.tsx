'use client'

import { useState, useCallback } from 'react'
import { ApprovalCard } from '@/components/jk/approval-card'
import { GatePipeline } from '@/components/jk/gate-pipeline'
import type { ApprovalQueueItem, GateStatus } from '@/lib/jk/approval-queue'

interface Props {
  brandId: number
  monthYear: string
  initialQueue: ApprovalQueueItem[]
  initialGates: GateStatus[]
}

function ApprovalCardSkeleton() {
  return (
    <div className="animate-pulse border border-neutral-800 rounded-lg bg-neutral-900 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-neutral-800">
        <div className="h-5 w-32 bg-neutral-800 rounded-full mb-2" />
        <div className="h-3 w-48 bg-neutral-800 rounded" />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="h-3 w-16 bg-neutral-800 rounded" />
        <div className="h-4 w-full bg-neutral-800 rounded" />
        <div className="h-4 w-4/5 bg-neutral-800 rounded" />
      </div>
      <div className="border-t border-neutral-800 px-4 py-3 flex gap-2">
        <div className="h-8 w-24 bg-neutral-800 rounded" />
        <div className="h-8 w-18 bg-neutral-800 rounded" />
        <div className="h-8 w-18 bg-neutral-800 rounded" />
      </div>
    </div>
  )
}

export function BrandApprovalQueueTab({ brandId, monthYear, initialQueue, initialGates }: Props) {
  const [queue, setQueue] = useState<ApprovalQueueItem[]>(initialQueue)
  const [gates, setGates] = useState<GateStatus[]>(initialGates)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/jk/brands/${brandId}/approval-queue?month=${monthYear}`)
      if (res.ok) {
        const data = await res.json()
        setQueue(data.queue)
        setGates(data.gates)
      }
    } finally {
      setLoading(false)
    }
  }, [brandId, monthYear])

  return (
    <div className="space-y-6">
      {/* Month header */}
      <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
        Bulan ini: {monthYear}
      </div>

      {/* Gate Pipeline */}
      <div>
        <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Pipeline Status</div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <GatePipeline gates={gates} />
        </div>
      </div>

      {/* Approval Queue */}
      <div>
        {queue.length === 0 ? (
          <div className="border border-dashed border-neutral-700 rounded-lg p-10 text-center">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-neutral-400 font-medium">Tidak ada approval pending</div>
            <div className="text-sm text-neutral-600 mt-1">
              Semua gate sudah selesai atau agent belum generate output bulan ini.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Approval yang Menunggu ({queue.length} item)
            </div>
            {loading ? (
              <ApprovalCardSkeleton />
            ) : (
              queue.map(item => (
                <ApprovalCard key={item.id} item={item} onDecision={refresh} />
              ))
            )}
          </div>
        )}
      </div>

      <div className="text-xs text-neutral-600 flex items-center gap-1">
        <span>Keyboard: hover kartu → </span>
        <kbd className="px-1 py-0.5 rounded bg-neutral-800 text-neutral-500 font-mono">Y</kbd>
        <span>approve,</span>
        <kbd className="px-1 py-0.5 rounded bg-neutral-800 text-neutral-500 font-mono">N</kbd>
        <span>reject</span>
      </div>

      {/* Locked gate notice */}
      {gates.some(g => g.status === 'locked') && (
        <div className="border border-neutral-700 rounded-lg bg-neutral-900/50 p-4 text-sm text-neutral-400">
          🔒 Gate berikutnya terkunci — selesaikan semua approval di gate saat ini terlebih dahulu.
          Agent akan otomatis generate output setelah gate sebelumnya diapprove.
        </div>
      )}
    </div>
  )
}
