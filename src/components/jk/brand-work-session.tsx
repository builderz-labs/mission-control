'use client'

import { useState } from 'react'
import { BrandApprovalQueueTab } from '@/components/jk/tabs/brand-approval-queue-tab'
import { BrandKpiTab } from '@/components/jk/tabs/brand-kpi-tab'
import { BrandProjectsTab } from '@/components/jk/tabs/brand-projects-tab'
import type { ApprovalQueueItem, GateStatus } from '@/lib/jk/approval-queue'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: Record<string, any>
  initialQueue: ApprovalQueueItem[]
  initialGates: GateStatus[]
  nsm: any
  kpis: any[]
  monthYear: string
  pendingCount: number
}

type Tab = 'queue' | 'kpi' | 'projects' | 'content' | 'analytics'

export function BrandWorkSession({ brand, initialQueue, initialGates, nsm, kpis, monthYear, pendingCount }: Props) {
  const defaultTab: Tab = pendingCount > 0 ? 'queue' : 'kpi'
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab)

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'queue', label: 'Approval Queue', badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'kpi', label: 'KPI & Strategi' },
    { id: 'projects', label: 'Projects' },
    { id: 'content', label: 'Konten' },
    { id: 'analytics', label: 'Analytics' },
  ]

  return (
    <div className="px-6 py-4">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-neutral-800 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab.label}
            {tab.badge != null && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-amber-400/20 text-amber-400 font-semibold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'queue' && (
        <BrandApprovalQueueTab
          brandId={brand.id}
          monthYear={monthYear}
          initialQueue={initialQueue}
          initialGates={initialGates}
        />
      )}

      {activeTab === 'kpi' && (
        <BrandKpiTab nsm={nsm} kpis={kpis} />
      )}

      {activeTab === 'projects' && (
        <BrandProjectsTab brandId={brand.id} />
      )}

      {activeTab === 'content' && (
        <div className="border border-dashed border-neutral-700 rounded-lg p-8 text-center text-neutral-500">
          <div className="text-2xl mb-2">📝</div>
          <div className="font-medium text-neutral-400">Content Hub Brand</div>
          <div className="text-sm mt-1">Konten dengan filter CEP akan dibangun di Fase G.</div>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="border border-dashed border-neutral-700 rounded-lg p-8 text-center text-neutral-500">
          <div className="text-2xl mb-2">📊</div>
          <div className="font-medium text-neutral-400">Analytics Brand</div>
          <div className="text-sm mt-1">Analytics dan KPI Hub akan dibangun di Fase D.</div>
        </div>
      )}
    </div>
  )
}
