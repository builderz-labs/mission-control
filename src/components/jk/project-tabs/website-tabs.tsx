'use client'

import { useState } from 'react'
import { MilestonesTab } from './seo-tabs'

type WebsiteTabId = 'brief' | 'kak' | 'milestones' | 'tech_audit' | 'handover'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  website: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  milestones: any[]
}

const TABS: { id: WebsiteTabId; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'kak', label: 'KAK Teknis' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'tech_audit', label: 'Tech Audit' },
  { id: 'handover', label: 'Handover' },
]

export function WebsiteProjectTabs({ project, website, milestones }: Props) {
  const [active, setActive] = useState<WebsiteTabId>('brief')

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

      {active === 'brief' && <WebsiteBriefTab project={project} website={website} />}
      {active === 'kak' && <KakTab website={website} />}
      {active === 'milestones' && <MilestonesTab milestones={milestones} />}
      {active === 'tech_audit' && <TechAuditTab website={website} />}
      {active === 'handover' && <HandoverTab website={website} milestones={milestones} />}
    </div>
  )
}

function WebsiteBriefTab({ project, website }: { project: Record<string, any>; website: Record<string, any> }) {
  const pages: string[] = (() => {
    try { return JSON.parse(website.pages_required || '[]') } catch { return [] }
  })()

  return (
    <div className="space-y-4">
      {project.description && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Brief Project</div>
          <div className="text-sm text-neutral-200">{project.description}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Tipe Website</div>
          <div className="text-sm text-neutral-200">{website.website_type ?? '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Platform</div>
          <div className="text-sm text-neutral-200">{website.platform ?? '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Hosting</div>
          <div className="text-sm text-neutral-200">{website.hosting_provider ?? '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Domain</div>
          <div className="text-sm font-mono text-neutral-200">{website.domain ?? '—'}</div>
        </div>
      </div>
      {pages.length > 0 && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-2">Halaman yang Dibutuhkan ({pages.length})</div>
          <div className="flex flex-wrap gap-1">
            {pages.map(p => (
              <span key={p} className="text-xs px-2 py-0.5 bg-neutral-700 text-neutral-300 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
      {website.ssl_included ? (
        <div className="text-xs text-green-400">✓ SSL included</div>
      ) : (
        <div className="text-xs text-amber-400">⚠ SSL tidak di-include</div>
      )}
    </div>
  )
}

function KakTab({ website }: { website: Record<string, any> }) {
  const specs = [
    { label: 'LCP Target', value: website.lcp_target != null ? `${website.lcp_target}s` : null, target: '< 2.5s', ok: website.lcp_target != null && website.lcp_target <= 2.5 },
    { label: 'CLS Target', value: website.cls_target != null ? String(website.cls_target) : null, target: '< 0.1', ok: website.cls_target != null && website.cls_target <= 0.1 },
    { label: 'INP Target', value: website.inp_target != null ? `${website.inp_target}ms` : null, target: '< 200ms', ok: website.inp_target != null && website.inp_target <= 200 },
    { label: 'PageSpeed Score', value: website.pagespeed_target != null ? `${website.pagespeed_target}/100` : null, target: '≥ 90', ok: website.pagespeed_target != null && website.pagespeed_target >= 90 },
  ]

  const hasAnySpec = specs.some(s => s.value != null)

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium text-neutral-400 mb-2">Core Web Vitals Target</div>
        <div className="grid grid-cols-2 gap-3">
          {specs.map(s => (
            <div key={s.label} className={`rounded-lg p-3 ${s.value != null ? (s.ok ? 'bg-green-900/30' : 'bg-neutral-800') : 'bg-neutral-800'}`}>
              <div className="text-xs text-neutral-400 mb-1">{s.label}</div>
              <div className={`text-lg font-bold ${s.value != null && s.ok ? 'text-green-400' : 'text-neutral-100'}`}>
                {s.value ?? '—'}
              </div>
              <div className="text-xs text-neutral-500">Good: {s.target}</div>
            </div>
          ))}
        </div>
      </div>
      {!hasAnySpec && (
        <div className="border border-dashed border-neutral-700 rounded-lg p-4 text-center text-neutral-500 text-xs">
          Spesifikasi teknis belum diset. Update via API PATCH atau KAK editor.
        </div>
      )}
    </div>
  )
}

function TechAuditTab({ website }: { website: Record<string, any> }) {
  const checklist: Array<{ item: string; done: boolean }> = (() => {
    try { return JSON.parse(website.tech_checklist || '[]') } catch { return [] }
  })()

  if (checklist.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">🔧</div>
        <div className="font-medium text-neutral-400">Tech checklist kosong</div>
        <div className="text-xs mt-1">Checklist akan diisi saat pre-launch audit.</div>
      </div>
    )
  }

  const done = checklist.filter(c => c.done).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-neutral-400">Tech Audit Checklist</div>
        <div className="text-xs text-neutral-400">{done}/{checklist.length} done</div>
      </div>
      <div className="h-1.5 bg-neutral-700 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all"
          style={{ width: `${checklist.length > 0 ? Math.round((done / checklist.length) * 100) : 0}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {checklist.map((c, i) => (
          <div key={i} className="flex items-center gap-2 bg-neutral-800 rounded px-3 py-2 text-xs">
            <span>{c.done ? '✅' : '⬜'}</span>
            <span className={c.done ? 'text-neutral-400 line-through' : 'text-neutral-200'}>{c.item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HandoverTab({ website, milestones }: { website: Record<string, any>; milestones: any[] }) {
  const handoverDate = website.handover_date ? new Date(website.handover_date * 1000).toLocaleDateString('id-ID') : null
  const signed = website.handover_signed === 1 || website.handover_signed === true

  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-4 border ${signed ? 'border-green-600 bg-green-900/20' : 'border-neutral-700 bg-neutral-800'}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{signed ? '✅' : '⏳'}</span>
          <div>
            <div className="font-medium text-neutral-100">{signed ? 'Handover Selesai' : 'Menunggu Handover'}</div>
            {handoverDate && <div className="text-xs text-neutral-400 mt-0.5">Tanggal handover: {handoverDate}</div>}
          </div>
        </div>
      </div>
      {milestones.length > 0 && (
        <div>
          <div className="text-xs font-medium text-neutral-400 mb-2">Milestone Handover</div>
          <MilestonesTab milestones={milestones.filter(m => m.milestone_name.toLowerCase().includes('handover') || m.milestone_name.toLowerCase().includes('selesai'))} />
        </div>
      )}
    </div>
  )
}
