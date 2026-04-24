'use client'

import { useState } from 'react'
import { MilestonesTab } from './seo-tabs'

type AdsTabId = 'brief' | 'campaigns' | 'performance' | 'budget' | 'cep_attribution'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ads: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaigns: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  milestones: any[]
}

const TABS: { id: AdsTabId; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'performance', label: 'Performance' },
  { id: 'budget', label: 'Budget Tracker' },
  { id: 'cep_attribution', label: 'CEP Attribution' },
]

function fmt(n: number | null | undefined, prefix = '', suffix = '') {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('id-ID')}${suffix}`
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return `Rp ${n.toLocaleString('id-ID')}`
}

export function AdsProjectTabs({ project, ads, campaigns, milestones }: Props) {
  const [active, setActive] = useState<AdsTabId>('brief')

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

      {active === 'brief' && <AdsBriefTab project={project} ads={ads} milestones={milestones} />}
      {active === 'campaigns' && <CampaignsTab campaigns={campaigns} />}
      {active === 'performance' && <PerformanceTab campaigns={campaigns} ads={ads} />}
      {active === 'budget' && <BudgetTab ads={ads} campaigns={campaigns} />}
      {active === 'cep_attribution' && <CepAttributionTab ads={ads} campaigns={campaigns} />}
    </div>
  )
}

function AdsBriefTab({ project, ads, milestones }: { project: Record<string, any>; ads: Record<string, any>; milestones: any[] }) {
  return (
    <div className="space-y-4">
      {project.description && (
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Brief Project</div>
          <div className="text-sm text-neutral-200">{project.description}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800 rounded-lg p-3 col-span-2">
          <div className="text-xs text-neutral-400 mb-1">Objective</div>
          <div className="text-sm text-neutral-200">{ads.objective ?? '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Budget Bulanan</div>
          <div className="text-lg font-bold text-neutral-100">{fmtCurrency(ads.monthly_budget)}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">ROAS Target</div>
          <div className="text-lg font-bold text-neutral-100">{ads.roas_target != null ? `${ads.roas_target}x` : '—'}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">CPA Target</div>
          <div className="text-lg font-bold text-neutral-100">{fmtCurrency(ads.cpa_target)}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Leads Target</div>
          <div className="text-lg font-bold text-neutral-100">{ads.leads_target ?? '—'}</div>
        </div>
      </div>
      {(ads.ads_account_id || ads.pixel_id) && (
        <div className="bg-neutral-800 rounded-lg p-3 space-y-1">
          {ads.ads_account_id && <div className="text-xs text-neutral-400">Ads Account: <span className="text-neutral-200 font-mono">{ads.ads_account_id}</span></div>}
          {ads.pixel_id && <div className="text-xs text-neutral-400">Pixel ID: <span className="text-neutral-200 font-mono">{ads.pixel_id}</span></div>}
          {ads.capi_enabled ? <div className="text-xs text-green-400">✓ CAPI enabled</div> : null}
        </div>
      )}
      {milestones.length > 0 && (
        <div>
          <div className="text-xs font-medium text-neutral-400 mb-2">Milestones</div>
          <MilestonesTab milestones={milestones} />
        </div>
      )}
    </div>
  )
}

function CampaignsTab({ campaigns }: { campaigns: any[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">📣</div>
        <div className="font-medium text-neutral-400">Belum ada campaign</div>
        <div className="text-xs mt-1">Campaign akan muncul setelah disync dari platform ads.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {campaigns.map(c => (
        <div key={c.id} className="bg-neutral-800 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="text-sm font-medium text-neutral-200">{c.name}</div>
            <CampaignStatusBadge status={c.status} />
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs text-neutral-400">
            <div>Spend: <span className="text-neutral-300">{fmtCurrency(c.spend)}</span></div>
            <div>ROAS: <span className="text-neutral-300">{c.roas != null ? `${c.roas}x` : '—'}</span></div>
            <div>CPA: <span className="text-neutral-300">{fmtCurrency(c.cpa)}</span></div>
            <div>Leads: <span className="text-neutral-300">{c.leads ?? '—'}</span></div>
          </div>
        </div>
      ))}
    </div>
  )
}

function PerformanceTab({ campaigns, ads }: { campaigns: any[]; ads: Record<string, any> }) {
  if (campaigns.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">📈</div>
        <div className="font-medium text-neutral-400">Data performance belum tersedia</div>
      </div>
    )
  }

  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0)
  const totalLeads = campaigns.reduce((s, c) => s + (c.leads ?? 0), 0)
  const totalClicks = campaigns.reduce((s, c) => s + (c.clicks ?? 0), 0)
  const avgRoas = campaigns.filter(c => c.roas != null).reduce((s, c, _, arr) => s + c.roas / arr.length, 0) || null

  const roasOk = avgRoas != null && ads.roas_target != null && avgRoas >= ads.roas_target
  const cpaOk = totalLeads > 0 && ads.cpa_target != null && (totalSpend / totalLeads) <= ads.cpa_target

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Total Spend</div>
          <div className="text-lg font-bold text-neutral-100">{fmtCurrency(totalSpend)}</div>
        </div>
        <div className={`rounded-lg p-3 ${avgRoas != null ? (roasOk ? 'bg-green-900/30' : 'bg-red-900/30') : 'bg-neutral-800'}`}>
          <div className="text-xs text-neutral-400 mb-1">Avg ROAS</div>
          <div className={`text-lg font-bold ${roasOk ? 'text-green-400' : avgRoas != null ? 'text-red-400' : 'text-neutral-100'}`}>
            {avgRoas != null ? `${avgRoas.toFixed(1)}x` : '—'}
          </div>
          {ads.roas_target && <div className="text-xs text-neutral-500">Target: {ads.roas_target}x</div>}
        </div>
        <div className={`rounded-lg p-3 ${totalLeads > 0 ? (cpaOk ? 'bg-green-900/30' : 'bg-red-900/30') : 'bg-neutral-800'}`}>
          <div className="text-xs text-neutral-400 mb-1">CPA Aktual</div>
          <div className={`text-lg font-bold ${cpaOk ? 'text-green-400' : totalLeads > 0 ? 'text-red-400' : 'text-neutral-100'}`}>
            {totalLeads > 0 ? fmtCurrency(Math.round(totalSpend / totalLeads)) : '—'}
          </div>
          {ads.cpa_target && <div className="text-xs text-neutral-500">Target: {fmtCurrency(ads.cpa_target)}</div>}
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Total Leads</div>
          <div className="text-lg font-bold text-neutral-100">{fmt(totalLeads)}</div>
          {ads.leads_target && <div className="text-xs text-neutral-500">Target: {ads.leads_target}</div>}
        </div>
        <div className="bg-neutral-800 rounded-lg p-3 col-span-2">
          <div className="text-xs text-neutral-400 mb-1">Total Clicks</div>
          <div className="text-lg font-bold text-neutral-100">{fmt(totalClicks)}</div>
        </div>
      </div>
    </div>
  )
}

function BudgetTab({ ads, campaigns }: { ads: Record<string, any>; campaigns: any[] }) {
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0)
  const budget = ads.monthly_budget ?? 0
  const pct = budget > 0 ? Math.min(100, Math.round((totalSpend / budget) * 100)) : 0
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#eab308' : '#22c55e'

  return (
    <div className="space-y-4">
      <div className="bg-neutral-800 rounded-lg p-4">
        <div className="flex justify-between text-xs text-neutral-400 mb-2">
          <span>Spend</span>
          <span>{fmtCurrency(totalSpend)} / {fmtCurrency(budget)}</span>
        </div>
        <div className="h-3 bg-neutral-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <div className="mt-2 text-right text-xs" style={{ color }}>{pct}% terpakai</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Budget Bulanan</div>
          <div className="text-lg font-bold text-neutral-100">{fmtCurrency(budget)}</div>
        </div>
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-1">Sisa Budget</div>
          <div className={`text-lg font-bold ${budget - totalSpend < 0 ? 'text-red-400' : 'text-neutral-100'}`}>
            {fmtCurrency(budget - totalSpend)}
          </div>
        </div>
      </div>
    </div>
  )
}

function CepAttributionTab({ ads, campaigns }: { ads: Record<string, any>; campaigns: any[] }) {
  const cepTargeting: any[] = (() => {
    try { return JSON.parse(ads.cep_targeting || '[]') } catch { return [] }
  })()

  if (cepTargeting.length === 0) {
    return (
      <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-neutral-500">
        <div className="text-2xl mb-2">🎯</div>
        <div className="font-medium text-neutral-400">CEP Attribution belum diset</div>
        <div className="text-xs mt-1">Mapping CEP → campaign akan tersedia setelah Gate 2 diapprove.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {cepTargeting.map((ct: any, i: number) => (
        <div key={i} className="bg-neutral-800 rounded-lg px-3 py-2.5">
          <div className="text-sm text-neutral-200">{ct.cep_name ?? `CEP ${i + 1}`}</div>
          {ct.campaign_names && (
            <div className="text-xs text-neutral-500 mt-0.5">{ct.campaign_names.join(', ')}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-900/50 text-green-300',
    paused: 'bg-amber-900/50 text-amber-300',
    completed: 'bg-neutral-700 text-neutral-400',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${map[status] ?? 'bg-neutral-700 text-neutral-400'}`}>
      {status}
    </span>
  )
}
