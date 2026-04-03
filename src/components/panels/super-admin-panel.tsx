'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import type { SuperTab, ProvisionEvent } from './super-admin/super-admin-types'
import { useSuperAdminData } from './super-admin/use-super-admin-data'
import { useSuperAdminActions } from './super-admin/use-super-admin-actions'
import { TenantTable } from './super-admin/tenant-table'
import { JobsTable } from './super-admin/jobs-table'
import { EventsLog } from './super-admin/events-log'
import { CreateWorkspaceForm } from './super-admin/create-workspace-form'
import { DecommissionDialog } from './super-admin/decommission-dialog'

const FORM_DEFAULTS = {
  slug: '', display_name: '', linux_user: '',
  plan_tier: 'standard', owner_gateway: 'openclaw-main',
  gateway_port: '', dashboard_port: '', dry_run: true,
} as const

export function SuperAdminPanel() {
  const { currentUser, dashboardMode } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const { tenants, jobs, localJobEvents, gatewayOptions, gatewayLoadError, loading, error, load } =
    useSuperAdminData(isLocal, currentUser?.username)

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedJobEvents, setSelectedJobEvents] = useState<ProvisionEvent[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [activeTab, setActiveTab] = useState<SuperTab>('tenants')
  const [createExpanded, setCreateExpanded] = useState(false)
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null)
  const [form, setForm] = useState({ ...FORM_DEFAULTS })

  // Cancel auto-dismiss timer on unmount to prevent post-unmount setState
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }, [])

  const showFeedback = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3500)
  }, [])

  useEffect(() => { setOpenActionMenu(null) }, [activeTab])

  const {
    busyJobId, decommissionDialog, canSubmitDecommission,
    loadJobDetail, runJob, approveAndRunJob, setJobState,
    openDecommissionDialog, closeDecommissionDialog,
    queueDecommissionFromDialog, updateDecommissionDialog,
  } = useSuperAdminActions({
    isLocal, localJobEvents, load,
    setSelectedJobId, setSelectedJobEvents,
    setActiveTab, setOpenActionMenu, showFeedback,
  })

  const kpis = useMemo(() => ({
    active: tenants.filter((t) => t.status === 'active').length,
    pending: tenants.filter((t) => ['pending', 'provisioning', 'decommissioning'].includes(t.status)).length,
    errored: tenants.filter((t) => t.status === 'error').length,
    queuedApprovals: jobs.filter((j) => j.status === 'queued').length,
  }), [tenants, jobs])

  const createTenant = async () => {
    if (!form.slug.trim() || !form.display_name.trim()) {
      showFeedback(false, 'Slug and display name are required'); return
    }
    try {
      const res = await fetch('/api/super/tenants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: form.slug.trim().toLowerCase(), display_name: form.display_name.trim(), linux_user: form.linux_user.trim() || undefined, plan_tier: form.plan_tier, owner_gateway: form.owner_gateway.trim() || undefined, gateway_port: form.gateway_port ? Number(form.gateway_port) : undefined, dashboard_port: form.dashboard_port ? Number(form.dashboard_port) : undefined, dry_run: form.dry_run }),
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to create tenant')
      showFeedback(true, `Tenant ${form.slug} created. Bootstrap job queued.`)
      setForm({ ...FORM_DEFAULTS })
      await load()
      if (json?.job?.id) await loadJobDetail(Number(json.job.id))
    } catch (e: unknown) { showFeedback(false, getErrorMessage(e) || 'Failed to create tenant') }
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">Access Denied</div>
        <p className="text-sm text-muted-foreground">Super Admin requires admin privileges.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mx-auto mb-2" />
        <span className="text-sm text-muted-foreground">Loading super admin data...</span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Super Ultron Admin</h2>
          <p className="text-sm text-muted-foreground">
            {isLocal ? 'Local control plane view over scheduler automations and runtime state.' : 'Multi-tenant provisioning control plane with approval gates and safer destructive actions.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateExpanded(true)}>+ Add Workspace</Button>
          <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          { label: 'Active Orgs', value: kpis.active, color: 'text-foreground' },
          { label: 'Pending / In Progress', value: kpis.pending, color: 'text-foreground' },
          { label: 'Errored Orgs', value: kpis.errored, color: 'text-red-400' },
          { label: 'Queued Approvals', value: kpis.queuedApprovals, color: 'text-amber-400' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${feedback.ok ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {feedback.text}
        </div>
      )}
      {error && <div className="px-3 py-2 rounded-md text-sm border bg-red-500/10 text-red-400 border-red-500/20">{error}</div>}

      {createExpanded && (
        <CreateWorkspaceForm form={form} gatewayOptions={gatewayOptions} gatewayLoadError={gatewayLoadError}
          onFormChange={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
          onCreate={createTenant} onClose={() => setCreateExpanded(false)} />
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          {(['tenants', 'jobs', 'events'] as SuperTab[]).map((tab) => (
            <Button key={tab} variant={activeTab === tab ? 'secondary' : 'ghost'} size="sm" onClick={() => setActiveTab(tab)}
              className={`capitalize ${activeTab === tab ? 'bg-primary/20 text-primary border border-primary/30' : 'border border-transparent'}`}>
              {tab === 'tenants' ? 'Organizations' : tab}
            </Button>
          ))}
        </div>
        {activeTab === 'tenants' && (
          <TenantTable tenants={tenants} jobs={jobs} isLocal={isLocal} gatewayOptions={gatewayOptions}
            gatewayLoadError={gatewayLoadError} openActionMenu={openActionMenu}
            setOpenActionMenu={setOpenActionMenu} onLoadJobDetail={loadJobDetail} onOpenDecommission={openDecommissionDialog} />
        )}
        {activeTab === 'jobs' && (
          <JobsTable jobs={jobs} isLocal={isLocal} selectedJobId={selectedJobId} busyJobId={busyJobId}
            openActionMenu={openActionMenu} setOpenActionMenu={setOpenActionMenu} onLoadJobDetail={loadJobDetail}
            onApproveAndRun={approveAndRunJob} onSetJobState={setJobState} onRunJob={runJob} />
        )}
        {activeTab === 'events' && <EventsLog selectedJobId={selectedJobId} events={selectedJobEvents} />}
      </div>

      <DecommissionDialog dialog={decommissionDialog} canSubmit={canSubmitDecommission}
        onClose={closeDecommissionDialog} onSubmit={queueDecommissionFromDialog}
        onUpdate={updateDecommissionDialog} />
    </div>
  )
}
