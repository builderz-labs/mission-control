'use client'

import { useState } from 'react'

type SeoTabId = 'brief' | 'keywords' | 'deliverables' | 'tech_audit' | 'reporting'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seo: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keywords: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  milestones: any[]
}

const TABS: { id: SeoTabId; label: string }[] = [
  { id: 'brief', label: 'Brief & Baseline' },
  { id: 'keywords', label: 'Keywords & CEP' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'tech_audit', label: 'Tech Audit' },
  { id: 'reporting', label: 'Reporting' },
]

export function SeoProjectTabs({ project, seo, keywords, milestones }: Props) {
  const [active, setActive] = useState<SeoTabId>('brief')

  return (
    <div>
      <div className="flex gap-0 border-b border-neutral-700 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              active === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'brief' && <SeoBreifTab project={project} seo={seo} />}
      {active === 'keywords' && <SeoKeywordsTab keywords={keywords} />}
      {active === 'deliverables' && <MilestonesTab milestones={milestones} />}
      {active === 'tech_audit' && <PlaceholderTab label="Tech Audit" icon="🔧" note="Checklist teknis on-page, Core Web Vitals, dan crawlability." />}
      {active === 'reporting' && <SeoReportingTab seo={seo} />}
    </div>
  )
}

function SeoBreifTab({ project, seo }: { project: Record<string, any>; seo: Record<string, any> }) {
  return (
    <div className="space-y-4">
      {project.description && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Brief Project</div>
          <div className="text-sm text-neutral-200">{project.description}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <MetricBox label="Domain Authority" value={seo.baseline_da ?? '—'} unit="" />
        <MetricBox label="Monthly Sessions" value={seo.baseline_sessions?.toLocaleString() ?? '—'} unit="" />
        <MetricBox label="Avg. Position" value={seo.baseline_avg_position ?? '—'} unit="pos" />
        <MetricBox label="Indexed Pages" value={seo.baseline_indexed_pages?.toLocaleString() ?? '—'} unit="" />
      </div>
      {seo.ai_visibility_score != null && (
        <div className="bg-neutral-800 rounded-lg p-3 flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <div className="text-xs text-neutral-400">AI Visibility Score</div>
            <div className="text-lg font-bold text-blue-400">{seo.ai_visibility_score}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function SeoKeywordsTab({ keywords }: { keywords: any[] }) {
  if (keywords.length === 0) {
    return <EmptyState icon="🔑" label="Belum ada keyword" note="Tambahkan keyword via API atau upload CSV." />
  }

  const clusters = Array.from(new Set(keywords.map(k => k.cluster || 'Unclustered')))

  return (
    <div className="space-y-4">
      {clusters.map(cluster => (
        <div key={cluster}>
          <div className="text-xs font-medium text-neutral-400 mb-2 uppercase tracking-wide">{cluster}</div>
          <div className="space-y-1">
            {keywords.filter(k => (k.cluster || 'Unclustered') === cluster).map(k => (
              <div key={k.id} className="flex items-center justify-between bg-neutral-800 rounded px-3 py-2 text-xs">
                <span className="text-neutral-200">{k.keyword}</span>
                <div className="flex items-center gap-3 text-neutral-400">
                  {k.monthly_volume != null && <span>{k.monthly_volume.toLocaleString()} vol</span>}
                  {k.current_position != null && (
                    <span className={k.target_position != null && k.current_position <= k.target_position ? 'text-green-400' : 'text-amber-400'}>
                      pos {k.current_position}
                    </span>
                  )}
                  {k.ai_overview_target ? <span className="text-blue-400">AI</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SeoReportingTab({ seo }: { seo: Record<string, any> }) {
  return (
    <div className="space-y-3">
      <div className="bg-neutral-800 rounded-lg p-3">
        <div className="text-xs text-neutral-400 mb-1">Reporting Day</div>
        <div className="text-sm text-neutral-200">Tanggal {seo.monthly_reporting_day ?? 1} setiap bulan</div>
      </div>
      <PlaceholderTab label="Laporan Bulanan" icon="📊" note="Laporan performa SEO otomatis dari GanSEO akan tersedia di sini." />
    </div>
  )
}

export function MilestonesTab({ milestones }: { milestones: any[] }) {
  if (milestones.length === 0) {
    return <EmptyState icon="🎯" label="Belum ada milestone" note="Tambahkan milestone untuk tracking deliverables." />
  }

  const now = Math.floor(Date.now() / 1000)

  return (
    <div className="space-y-2">
      {milestones.map(m => {
        const isOverdue = m.status !== 'completed' && m.deadline && m.deadline < now
        const deadlineDate = m.deadline ? new Date(m.deadline * 1000).toLocaleDateString('id-ID') : null

        return (
          <div key={m.id} className={`flex items-start gap-3 bg-neutral-800 rounded-lg px-3 py-2.5 ${isOverdue ? 'border border-red-800' : ''}`}>
            <span className="mt-0.5 text-sm">
              {m.status === 'completed' ? '✅' : isOverdue ? '🔴' : '⏳'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-neutral-200">{m.milestone_name}</div>
              {deadlineDate && (
                <div className={`text-xs mt-0.5 ${isOverdue ? 'text-red-400' : 'text-neutral-500'}`}>
                  {isOverdue ? 'Overdue — ' : ''}{deadlineDate}
                </div>
              )}
              {m.invoice_percentage != null && (
                <div className="text-xs text-neutral-500 mt-0.5">Invoice {m.invoice_percentage}%</div>
              )}
            </div>
            <StatusBadge status={m.status} />
          </div>
        )
      })}
    </div>
  )
}

function MetricBox({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="bg-neutral-800 rounded-lg p-3">
      <div className="text-xs text-neutral-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-neutral-100">
        {value}<span className="text-xs text-neutral-500 ml-1">{unit}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-neutral-700 text-neutral-300',
    in_progress: 'bg-blue-900/50 text-blue-300',
    completed: 'bg-green-900/50 text-green-300',
    cancelled: 'bg-red-900/50 text-red-300',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${map[status] ?? 'bg-neutral-700 text-neutral-400'}`}>
      {status}
    </span>
  )
}

function EmptyState({ icon, label, note }: { icon: string; label: string; note: string }) {
  return (
    <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="font-medium text-neutral-400">{label}</div>
      <div className="text-xs mt-1">{note}</div>
    </div>
  )
}

function PlaceholderTab({ icon, label, note }: { icon: string; label: string; note: string }) {
  return <EmptyState icon={icon} label={label} note={note} />
}
