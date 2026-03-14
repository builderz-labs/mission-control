'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

type SuperTab = 'tenants' | 'jobs' | 'events'

interface TenantRow {
  id: number
  slug: string
  display_name: string
  linux_user: string
  created_by?: string
  owner_gateway?: string
  status: string
  plan_tier: string
  gateway_port: number | null
  dashboard_port: number | null
  created_at: number
  latest_job_id?: number | null
  latest_job_status?: string | null
}

interface ProvisionJob {
  id: number
  tenant_id: number
  tenant_slug?: string
  tenant_display_name?: string
  job_type: string
  status: string
  dry_run: number
  requested_by: string
  approved_by?: string | null
  started_at?: number | null
  completed_at?: number | null
  error_text?: string | null
  created_at: number
}

interface ProvisionEvent {
  id: number
  level: string
  step_key?: string | null
  message: string
  created_at: number
}

interface DecommissionDialogState {
  open: boolean
  tenant: TenantRow | null
  dryRun: boolean
  removeLinuxUser: boolean
  removeStateDirs: boolean
  reason: string
  confirmText: string
  submitting: boolean
}

interface GatewayOption {
  id: number
  name: string
  status?: string
  is_primary?: number
}

interface SchedulerTask {
  id: string
  name: string
  enabled: boolean
  lastRun: number | null
  nextRun: number
  running: boolean
  lastResult?: {
    ok: boolean
    message: string
    timestamp: number
  }
}

const TENANT_PAGE_SIZE = 8
const JOB_PAGE_SIZE = 8

export function SuperAdminPanel() {
  const t = useTranslations('superAdmin')
  const { currentUser, dashboardMode } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [jobs, setJobs] = useState<ProvisionJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedJobEvents, setSelectedJobEvents] = useState<ProvisionEvent[]>([])
  const [localJobEvents, setLocalJobEvents] = useState<Record<number, ProvisionEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyJobId, setBusyJobId] = useState<number | null>(null)

  const [activeTab, setActiveTab] = useState<SuperTab>('tenants')
  const [createExpanded, setCreateExpanded] = useState(false)

  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantStatusFilter, setTenantStatusFilter] = useState('all')
  const [tenantPage, setTenantPage] = useState(1)

  const [jobSearch, setJobSearch] = useState('')
  const [jobStatusFilter, setJobStatusFilter] = useState('all')
  const [jobTypeFilter, setJobTypeFilter] = useState('all')
  const [jobPage, setJobPage] = useState(1)

  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null)
  const [gatewayOptions, setGatewayOptions] = useState<GatewayOption[]>([])
  const [gatewayLoadError, setGatewayLoadError] = useState<string | null>(null)

  const [decommissionDialog, setDecommissionDialog] = useState<DecommissionDialogState>({
    open: false,
    tenant: null,
    dryRun: true,
    removeLinuxUser: false,
    removeStateDirs: false,
    reason: '',
    confirmText: '',
    submitting: false,
  })

  const [form, setForm] = useState({
    slug: '',
    display_name: '',
    linux_user: '',
    plan_tier: 'standard',
    owner_gateway: 'openclaw-main',
    gateway_port: '',
    dashboard_port: '',
    dry_run: true,
  })

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  const load = useCallback(async () => {
    try {
      const [tenantsRes, jobsRes, gatewaysRes, schedulerRes] = await Promise.all([
        fetch('/api/super/tenants', { cache: 'no-store' }),
        fetch('/api/super/provision-jobs?limit=250', { cache: 'no-store' }),
        fetch('/api/gateways', { cache: 'no-store' }),
        isLocal ? fetch('/api/scheduler', { cache: 'no-store' }) : Promise.resolve(null),
      ])

      const tenantsJson = await tenantsRes.json().catch(() => ({}))
      const jobsJson = await jobsRes.json().catch(() => ({}))
      const gatewaysJson = await gatewaysRes.json().catch(() => ({}))
      const schedulerJson = schedulerRes ? await schedulerRes.json().catch(() => ({})) : {}

      if (!tenantsRes.ok) throw new Error(tenantsJson?.error || 'Failed to load tenants')
      if (!jobsRes.ok) throw new Error(jobsJson?.error || 'Failed to load provision jobs')

      let tenantRows = Array.isArray(tenantsJson?.tenants) ? tenantsJson.tenants : []
      let jobRows = Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : []
      const gatewayRows = Array.isArray(gatewaysJson?.gateways) ? gatewaysJson.gateways : []
      const schedulerTasks: SchedulerTask[] = Array.isArray(schedulerJson?.tasks) ? schedulerJson.tasks : []
      const localEvents: Record<number, ProvisionEvent[]> = {}

      if (isLocal) {
        if (tenantRows.length === 0) {
          const primaryGateway = gatewayRows.find((gw: any) => Number(gw?.is_primary) === 1)
          const now = Math.floor(Date.now() / 1000)
          tenantRows = [{
            id: -1,
            slug: 'local-system',
            display_name: 'Local Mission Control',
            linux_user: currentUser?.username || 'local',
            created_by: 'local',
            owner_gateway: primaryGateway?.name || 'local',
            status: 'active',
            plan_tier: 'local',
            gateway_port: Number(primaryGateway?.port || 0) || null,
            dashboard_port: null,
            created_at: now,
            latest_job_id: null,
            latest_job_status: null,
          }]
        }

        if (jobRows.length === 0 && schedulerTasks.length > 0) {
          jobRows = schedulerTasks.map((task, index) => {
            const id = -1000 - index
            const status = task.running
              ? 'running'
              : (!task.enabled ? 'cancelled' : (task.lastResult?.ok === false ? 'failed' : (task.lastRun ? 'completed' : 'queued')))
            const eventRows: ProvisionEvent[] = []
            if (task.lastResult) {
              eventRows.push({
                id: id * -10,
                level: task.lastResult.ok ? 'info' : 'error',
                step_key: task.id,
                message: task.lastResult.message,
                created_at: Math.floor(task.lastResult.timestamp / 1000),
              })
            }
            eventRows.push({
              id: id * -10 + 1,
              level: 'info',
              step_key: task.id,
              message: `Next run: ${new Date(task.nextRun).toLocaleString()}`,
              created_at: Math.floor(Date.now() / 1000),
            })
            localEvents[id] = eventRows

            const lastRunSec = task.lastRun ? Math.floor(task.lastRun / 1000) : null
            return {
              id,
              tenant_id: -1,
              tenant_slug: 'local-system',
              tenant_display_name: 'Local Mission Control',
              job_type: 'automation',
              status,
              dry_run: 1,
              requested_by: 'scheduler',
              approved_by: null,
              started_at: lastRunSec,
              completed_at: status !== 'running' ? lastRunSec : null,
              error_text: task.lastResult?.ok === false ? task.lastResult.message : null,
              created_at: lastRunSec || Math.floor(task.nextRun / 1000),
            } as ProvisionJob
          })
        }
      }

      setTenants(tenantRows)
      setJobs(jobRows)
      setLocalJobEvents(localEvents)
      setGatewayOptions(gatewayRows.map((g: any) => ({ id: Number(g.id), name: String(g.name), status: g.status, is_primary: g.is_primary })))
      setGatewayLoadError(gatewaysRes.ok ? null : (gatewaysJson?.error || 'Failed to load gateways'))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load super admin data')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.username, isLocal])

  const loadJobDetail = useCallback(async (jobId: number) => {
    if (isLocal && jobId < 0) {
      setSelectedJobId(jobId)
      setSelectedJobEvents(localJobEvents[jobId] || [])
      setActiveTab('events')
      return
    }

    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to load job details')
      setSelectedJobId(jobId)
      setSelectedJobEvents(Array.isArray(json?.job?.events) ? json.job.events : [])
      setActiveTab('events')
    } catch (e: any) {
      showFeedback(false, e?.message || 'Failed to load job details')
    }
  }, [isLocal, localJobEvents])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    setTenantPage(1)
  }, [tenantSearch, tenantStatusFilter])

  useEffect(() => {
    setJobPage(1)
  }, [jobSearch, jobStatusFilter, jobTypeFilter])

  useEffect(() => {
    setOpenActionMenu(null)
  }, [activeTab])

  const latestByTenant = useMemo(() => {
    const map = new Map<number, ProvisionJob>()
    for (const job of jobs) {
      if (!map.has(job.tenant_id)) map.set(job.tenant_id, job)
    }
    return map
  }, [jobs])

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(tenants.map((t) => t.status))).sort()
    return ['all', ...values]
  }, [tenants])

  const jobStatusOptions = useMemo(() => {
    const values = Array.from(new Set(jobs.map((j) => j.status))).sort()
    return ['all', ...values]
  }, [jobs])

  const jobTypeOptions = useMemo(() => {
    const values = Array.from(new Set(jobs.map((j) => j.job_type))).sort()
    return ['all', ...values]
  }, [jobs])

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase()
    return tenants.filter((tenant) => {
      if (tenantStatusFilter !== 'all' && tenant.status !== tenantStatusFilter) return false
      if (!q) return true
      return [tenant.display_name, tenant.slug, tenant.linux_user, tenant.created_by || '', tenant.owner_gateway || '', tenant.status].join(' ').toLowerCase().includes(q)
    })
  }, [tenants, tenantSearch, tenantStatusFilter])

  const tenantPages = Math.max(1, Math.ceil(filteredTenants.length / TENANT_PAGE_SIZE))
  const pagedTenants = filteredTenants.slice((tenantPage - 1) * TENANT_PAGE_SIZE, tenantPage * TENANT_PAGE_SIZE)

  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase()
    return jobs.filter((job) => {
      if (jobStatusFilter !== 'all' && job.status !== jobStatusFilter) return false
      if (jobTypeFilter !== 'all' && job.job_type !== jobTypeFilter) return false
      if (!q) return true
      return [String(job.id), job.tenant_slug || '', String(job.tenant_id), job.requested_by, job.approved_by || '', job.status, job.job_type].join(' ').toLowerCase().includes(q)
    })
  }, [jobs, jobSearch, jobStatusFilter, jobTypeFilter])

  const jobPages = Math.max(1, Math.ceil(filteredJobs.length / JOB_PAGE_SIZE))
  const pagedJobs = filteredJobs.slice((jobPage - 1) * JOB_PAGE_SIZE, jobPage * JOB_PAGE_SIZE)

  const kpis = useMemo(() => {
    const active = tenants.filter((t) => t.status === 'active').length
    const pending = tenants.filter((t) => ['pending', 'provisioning', 'decommissioning'].includes(t.status)).length
    const errored = tenants.filter((t) => t.status === 'error').length
    const queuedApprovals = jobs.filter((j) => j.status === 'queued').length
    return { active, pending, errored, queuedApprovals }
  }, [tenants, jobs])

  const createTenant = async () => {
    if (!form.slug.trim() || !form.display_name.trim()) {
      showFeedback(false, t('slugAndNameRequired'))
      return
    }

    try {
      const res = await fetch('/api/super/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.slug.trim().toLowerCase(),
          display_name: form.display_name.trim(),
          linux_user: form.linux_user.trim() || undefined,
          plan_tier: form.plan_tier,
          owner_gateway: form.owner_gateway.trim() || undefined,
          gateway_port: form.gateway_port ? Number(form.gateway_port) : undefined,
          dashboard_port: form.dashboard_port ? Number(form.dashboard_port) : undefined,
          dry_run: form.dry_run,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to create tenant')

      showFeedback(true, t('tenantCreated', { slug: form.slug }))
      setForm({
        slug: '',
        display_name: '',
        linux_user: '',
        plan_tier: 'standard',
        owner_gateway: 'openclaw-main',
        gateway_port: '',
        dashboard_port: '',
        dry_run: true,
      })
      await load()
      const newJobId = json?.job?.id
      if (newJobId) await loadJobDetail(Number(newJobId))
    } catch (e: any) {
      showFeedback(false, e?.message || 'Failed to create tenant')
    }
  }

  const runJob = async (jobId: number) => {
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}/run`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to run job')
      showFeedback(true, t('jobExecuted', { jobId }))
      await load()
      await loadJobDetail(jobId)
    } catch (e: any) {
      showFeedback(false, e?.message || `Failed to run job #${jobId}`)
      await load()
      await loadJobDetail(jobId)
    } finally {
      setBusyJobId(null)
      setOpenActionMenu(null)
    }
  }

  const approveAndRunJob = async (jobId: number) => {
    setBusyJobId(jobId)
    try {
      const approveRes = await fetch(`/api/super/provision-jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const approveJson = await approveRes.json().catch(() => ({}))
      if (!approveRes.ok) throw new Error(approveJson?.error || `Failed to approve job #${jobId}`)

      const runRes = await fetch(`/api/super/provision-jobs/${jobId}/run`, { method: 'POST' })
      const runJson = await runRes.json().catch(() => ({}))
      if (!runRes.ok) throw new Error(runJson?.error || `Failed to run job #${jobId}`)

      showFeedback(true, t('jobApprovedExecuted', { jobId }))
      await load()
      await loadJobDetail(jobId)
    } catch (e: any) {
      showFeedback(false, e?.message || `Failed to approve/run job #${jobId}`)
      await load()
      await loadJobDetail(jobId)
    } finally {
      setBusyJobId(null)
      setOpenActionMenu(null)
    }
  }

  const openDecommissionDialog = (tenant: TenantRow) => {
    setOpenActionMenu(null)
    setDecommissionDialog({
      open: true,
      tenant,
      dryRun: true,
      removeLinuxUser: false,
      removeStateDirs: false,
      reason: '',
      confirmText: '',
      submitting: false,
    })
  }

  const closeDecommissionDialog = () => {
    setDecommissionDialog((prev) => ({ ...prev, open: false, submitting: false }))
  }

  const queueDecommissionFromDialog = async () => {
    const tenant = decommissionDialog.tenant
    if (!tenant) return

    if (!decommissionDialog.dryRun && decommissionDialog.confirmText.trim() !== tenant.slug) {
      showFeedback(false, t('typeToConfirm', { slug: tenant.slug }))
      return
    }

    setDecommissionDialog((prev) => ({ ...prev, submitting: true }))

    try {
      const res = await fetch(`/api/super/tenants/${tenant.id}/decommission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: decommissionDialog.dryRun,
          remove_linux_user: decommissionDialog.removeLinuxUser,
          remove_state_dirs: decommissionDialog.removeStateDirs,
          reason: decommissionDialog.reason.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to queue decommission job')

      const jobId = Number(json?.job?.id || 0)
      showFeedback(true, decommissionDialog.dryRun ? t('decommissionQueuedDryRun', { slug: tenant.slug }) : t('decommissionQueued', { slug: tenant.slug }))
      closeDecommissionDialog()
      await load()
      if (jobId > 0) await loadJobDetail(jobId)
    } catch (e: any) {
      setDecommissionDialog((prev) => ({ ...prev, submitting: false }))
      showFeedback(false, e?.message || `Failed to queue decommission for ${tenant.slug}`)
    }
  }

  const setJobState = async (jobId: number, action: 'approve' | 'reject' | 'cancel') => {
    const reason = window.prompt(t('optionalReason', { action })) || undefined
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Failed to ${action} job`)
      showFeedback(true, t('jobActioned', { jobId, action }))
      await load()
      await loadJobDetail(jobId)
    } catch (e: any) {
      showFeedback(false, e?.message || `Failed to ${action} job #${jobId}`)
    } finally {
      setBusyJobId(null)
      setOpenActionMenu(null)
    }
  }

  const canSubmitDecommission = !!decommissionDialog.tenant && (
    decommissionDialog.dryRun ||
    decommissionDialog.confirmText.trim() === decommissionDialog.tenant.slug
  )

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">{t('accessDenied')}</div>
        <p className="text-sm text-muted-foreground">{t('accessDeniedDesc')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mx-auto mb-2" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">
            {isLocal ? t('subtitleLocal') : t('subtitleMultiTenant')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setCreateExpanded(true)}
          >
            {t('addWorkspace')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{t('activeOrgs')}</div>
          <div className="text-xl font-semibold text-foreground mt-1">{kpis.active}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{t('pendingInProgress')}</div>
          <div className="text-xl font-semibold text-foreground mt-1">{kpis.pending}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{t('erroredOrgs')}</div>
          <div className="text-xl font-semibold text-red-400 mt-1">{kpis.errored}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{t('queuedApprovals')}</div>
          <div className="text-xl font-semibold text-amber-400 mt-1">{kpis.queuedApprovals}</div>
        </div>
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${
          feedback.ok
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {feedback.text}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-md text-sm border bg-red-500/10 text-red-400 border-red-500/20">
          {error}
        </div>
      )}

      {createExpanded && (
      <div className="rounded-lg border border-primary/30 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{t('createNewWorkspace')}</h3>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setCreateExpanded(false)}
            aria-label="Close create form"
            className="text-lg w-6 h-6"
          >
            ×
          </Button>
        </div>
          <div className="p-4 space-y-3">
            <div className="text-xs text-muted-foreground">
              {t('createWorkspaceHint')}
            </div>
            {gatewayLoadError && (
              <div className="px-3 py-2 rounded-md text-xs border bg-amber-500/10 text-amber-300 border-amber-500/20">
                Gateway list unavailable: {gatewayLoadError}. Using fallback owner value.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder={t('slugPlaceholder')}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              />
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder={t('displayNamePlaceholder')}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              />
              <input
                value={form.linux_user}
                onChange={(e) => setForm((f) => ({ ...f, linux_user: e.target.value }))}
                placeholder={t('linuxUserPlaceholder')}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              />
              <select
                value={form.owner_gateway}
                onChange={(e) => setForm((f) => ({ ...f, owner_gateway: e.target.value }))}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              >
                {gatewayOptions.length === 0 ? (
                  <option value={form.owner_gateway || 'openclaw-main'}>{form.owner_gateway || 'openclaw-main'}</option>
                ) : (
                  gatewayOptions.map((gw) => (
                    <option key={gw.id} value={gw.name}>
                      {gw.name}{gw.is_primary ? ' (primary)' : ''}
                    </option>
                  ))
                )}
              </select>
              <select
                value={form.plan_tier}
                onChange={(e) => setForm((f) => ({ ...f, plan_tier: e.target.value }))}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              >
                <option value="standard">{t('planStandard')}</option>
                <option value="pro">{t('planPro')}</option>
                <option value="enterprise">{t('planEnterprise')}</option>
              </select>
              <input
                value={form.gateway_port}
                onChange={(e) => setForm((f) => ({ ...f, gateway_port: e.target.value }))}
                placeholder={t('gatewayPortPlaceholder')}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              />
              <input
                value={form.dashboard_port}
                onChange={(e) => setForm((f) => ({ ...f, dashboard_port: e.target.value }))}
                placeholder={t('dashboardPortPlaceholder')}
                className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
              />
              <label className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.dry_run}
                  onChange={(e) => setForm((f) => ({ ...f, dry_run: e.target.checked }))}
                />
                {t('dryRun')}
              </label>
              <Button
                onClick={createTenant}
              >
                {t('createAndQueue')}
              </Button>
            </div>
          </div>
      </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          {(['tenants', 'jobs', 'events'] as SuperTab[]).map((tab) => (
            <Button
              key={tab}
              variant={activeTab === tab ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab(tab)}
              className={`capitalize ${
                activeTab === tab
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'border border-transparent'
              }`}
            >
              {tab === 'tenants' ? t('tabOrganizations') : tab === 'jobs' ? t('tabJobs') : t('tabEvents')}
            </Button>
          ))}
        </div>

        {activeTab === 'tenants' && (
          <div className="p-3 space-y-3">
            <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <input
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  placeholder={t('searchOrganizations')}
                  className="h-8 w-56 px-3 rounded-md bg-secondary border border-border text-xs text-foreground"
                />
                <select
                  value={tenantStatusFilter}
                  onChange={(e) => setTenantStatusFilter(e.target.value)}
                  className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground">
                {t('showing', { shown: pagedTenants.length, total: filteredTenants.length })}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Tenant list</caption>
                <thead>
                  <tr className="bg-secondary/30 border-b border-border">
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colTenant')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colSystemUser')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colOwner')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colStatus')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colLatestJob')}</th>
                    <th scope="col" className="text-right px-3 py-2 text-xs text-muted-foreground">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTenants.map((tenant) => {
                    const latest = latestByTenant.get(tenant.id)
                    const menuKey = `tenant-${tenant.id}`
                    return (
                      <tr key={tenant.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{tenant.display_name}</div>
                          <div className="text-xs text-muted-foreground">{tenant.slug}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{tenant.linux_user}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          <div className="text-foreground">{tenant.owner_gateway || t('unassigned')}</div>
                          <div className="text-[11px] text-muted-foreground">{t('by')} {tenant.created_by || t('unknownCreator')}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className={`px-2 py-0.5 rounded border ${
                            tenant.status === 'active' ? 'border-green-500/30 text-green-400' :
                            tenant.status === 'error' ? 'border-red-500/30 text-red-400' :
                            tenant.status === 'decommissioning' ? 'border-amber-500/30 text-amber-400' :
                            'border-border text-muted-foreground'
                          }`}>
                            {tenant.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {latest ? (
                            <Button variant="link" size="xs" onClick={() => loadJobDetail(latest.id)} className="p-0 h-auto">
                              #{latest.id} · {latest.status}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right relative">
                          {isLocal && tenant.id < 0 ? (
                            <span className="text-[11px] text-muted-foreground">{t('localReadOnly')}</span>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setOpenActionMenu((cur) => (cur === menuKey ? null : menuKey))}
                              >
                                Actions
                              </Button>
                              {openActionMenu === menuKey && (
                                <div className="absolute right-3 top-10 z-20 w-44 rounded-md border border-border bg-card shadow-xl text-left">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openDecommissionDialog(tenant)}
                                    className="w-full justify-start text-xs text-red-300 hover:bg-red-500/10 rounded-none"
                                  >
                                    {t('queueDecommission')}
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {pagedTenants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">{t('noMatchingOrgs')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs">
              <Button
                variant="outline"
                size="xs"
                disabled={tenantPage <= 1}
                onClick={() => setTenantPage((p) => Math.max(1, p - 1))}
              >
                {t('prev')}
              </Button>
              <span className="text-muted-foreground">{t('page', { page: tenantPage, total: tenantPages })}</span>
              <Button
                variant="outline"
                size="xs"
                disabled={tenantPage >= tenantPages}
                onClick={() => setTenantPage((p) => Math.min(tenantPages, p + 1))}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="p-3 space-y-3">
            <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder={t('searchJobs')}
                  className="h-8 w-56 px-3 rounded-md bg-secondary border border-border text-xs text-foreground"
                />
                <select
                  value={jobStatusFilter}
                  onChange={(e) => setJobStatusFilter(e.target.value)}
                  className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground"
                >
                  {jobStatusOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <select
                  value={jobTypeFilter}
                  onChange={(e) => setJobTypeFilter(e.target.value)}
                  className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground"
                >
                  {jobTypeOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground">
                {t('showing', { shown: pagedJobs.length, total: filteredJobs.length })}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Provisioning jobs</caption>
                <thead>
                  <tr className="bg-secondary/30 border-b border-border">
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colJob')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colTenant')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colStatus')}</th>
                    <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">{t('colRequestedApproved')}</th>
                    <th scope="col" className="text-right px-3 py-2 text-xs text-muted-foreground">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedJobs.map((job) => {
                    const menuKey = `job-${job.id}`
                    return (
                      <tr key={job.id} className={`border-b border-border/50 last:border-0 ${selectedJobId === job.id ? 'bg-primary/10' : 'hover:bg-secondary/20'}`}>
                        <td className="px-3 py-2">
                          <Button variant="link" size="xs" onClick={() => loadJobDetail(job.id)} className="p-0 h-auto">
                            #{job.id}
                          </Button>
                          <div className="text-[11px] text-muted-foreground">{job.job_type} {job.dry_run ? t('dryRun') : t('live')}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{job.tenant_slug || job.tenant_id}</td>
                        <td className="px-3 py-2 text-xs">{job.status}</td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground">
                          <div>{t('reqShort')}: {job.requested_by}</div>
                          <div>{t('apprShort')}: {job.approved_by || '-'}</div>
                        </td>
                        <td className="px-3 py-2 text-right relative">
                          {isLocal && job.id < 0 ? (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => loadJobDetail(job.id)}
                            >
                              {t('view')}
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setOpenActionMenu((cur) => (cur === menuKey ? null : menuKey))}
                              >
                                Actions
                              </Button>
                              {openActionMenu === menuKey && (
                                <div className="absolute right-3 top-10 z-20 w-40 rounded-md border border-border bg-card shadow-xl text-left">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => loadJobDetail(job.id)}
                                    className="w-full justify-start text-xs rounded-none"
                                  >
                                    {t('viewEvents')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => Number(job.dry_run) === 1 ? approveAndRunJob(job.id) : setJobState(job.id, 'approve')}
                                    disabled={busyJobId === job.id || !['queued', 'rejected', 'failed'].includes(job.status)}
                                    className="w-full justify-start text-xs text-emerald-400 hover:bg-emerald-500/10 rounded-none"
                                  >
                                    {Number(job.dry_run) === 1 ? t('approveAndRun') : t('approve')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setJobState(job.id, 'reject')}
                                    disabled={busyJobId === job.id || !['queued', 'approved', 'failed'].includes(job.status)}
                                    className="w-full justify-start text-xs text-amber-400 hover:bg-amber-500/10 rounded-none"
                                  >
                                    {t('reject')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => runJob(job.id)}
                                    disabled={busyJobId === job.id || job.status !== 'approved'}
                                    className="w-full justify-start text-xs text-primary hover:bg-primary/10 rounded-none"
                                  >
                                    {busyJobId === job.id ? t('running') : t('run')}
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {pagedJobs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">{t('noMatchingJobs')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs">
              <Button
                variant="outline"
                size="xs"
                disabled={jobPage <= 1}
                onClick={() => setJobPage((p) => Math.max(1, p - 1))}
              >
                {t('prev')}
              </Button>
              <span className="text-muted-foreground">{t('page', { page: jobPage, total: jobPages })}</span>
              <Button
                variant="outline"
                size="xs"
                disabled={jobPage >= jobPages}
                onClick={() => setJobPage((p) => Math.min(jobPages, p + 1))}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="p-3 space-y-2">
            <div className="text-xs text-muted-foreground px-1">
              {selectedJobId ? t('showingEventsForJob', { jobId: selectedJobId }) : t('selectJobForEvents')}
            </div>
            <div className="max-h-[420px] overflow-y-auto space-y-2">
              {selectedJobId && selectedJobEvents.length === 0 && (
                <div className="text-xs text-muted-foreground">{t('noEventsYet')}</div>
              )}
              {selectedJobEvents.map((ev) => (
                <div key={ev.id} className="rounded border border-border/60 bg-secondary/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground mb-0.5">
                    {new Date(ev.created_at * 1000).toLocaleString()} · {ev.level}{ev.step_key ? ` · ${ev.step_key}` : ''}
                  </div>
                  <div className="text-sm text-foreground">{ev.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {decommissionDialog.open && decommissionDialog.tenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">{t('queueDecommissionTitle', { name: decommissionDialog.tenant.display_name })}</h3>
              <p className="text-xs text-muted-foreground mt-1">{t('reviewImpact')}</p>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
                  <input
                    type="radio"
                    checked={decommissionDialog.dryRun}
                    onChange={() => setDecommissionDialog((prev) => ({ ...prev, dryRun: true, confirmText: '' }))}
                  />
                  <span>
                    <span className="block font-medium">{t('dryRunRecommended')}</span>
                    <span className="text-muted-foreground">{t('dryRunDesc')}</span>
                  </span>
                </label>
                <label className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
                  <input
                    type="radio"
                    checked={!decommissionDialog.dryRun}
                    onChange={() => setDecommissionDialog((prev) => ({ ...prev, dryRun: false }))}
                  />
                  <span>
                    <span className="block font-medium">{t('liveExecution')}</span>
                    <span className="text-red-200/80">{t('liveExecutionDesc')}</span>
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={decommissionDialog.removeLinuxUser}
                    onChange={(e) => setDecommissionDialog((prev) => ({
                      ...prev,
                      removeLinuxUser: e.target.checked,
                      removeStateDirs: e.target.checked ? false : prev.removeStateDirs,
                    }))}
                  />
                  <span>
                    <span className="block font-medium">{t('removeLinuxUser')}</span>
                    <span className="text-muted-foreground">{t('removeLinuxUserDesc')}</span>
                  </span>
                </label>
                <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={decommissionDialog.removeStateDirs}
                    disabled={decommissionDialog.removeLinuxUser}
                    onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, removeStateDirs: e.target.checked }))}
                  />
                  <span>
                    <span className="block font-medium">{t('removeStateDirs')}</span>
                    <span className="text-muted-foreground">{t('removeStateDirsDesc')}</span>
                  </span>
                </label>
              </div>

              <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground">
                <div className="font-medium mb-1">{t('impactSummary')}</div>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• {t('impactStopsService', { user: decommissionDialog.tenant.linux_user })}</li>
                  <li>• {t('impactRemovesEnv', { user: decommissionDialog.tenant.linux_user })}</li>
                  <li>• {decommissionDialog.removeLinuxUser ? t('impactLinuxUserRemoved') : (decommissionDialog.removeStateDirs ? t('impactStateDirsRemoved') : t('impactRetained'))}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <textarea
                  value={decommissionDialog.reason}
                  onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder={t('reasonOptional')}
                  className="w-full min-h-[72px] rounded-md bg-secondary border border-border px-3 py-2 text-sm text-foreground"
                />

                {!decommissionDialog.dryRun && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t('typeSlugLabel')} <span className="font-mono text-foreground">{decommissionDialog.tenant.slug}</span> {t('toConfirmLive')}
                    </label>
                    <input
                      value={decommissionDialog.confirmText}
                      onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, confirmText: e.target.value }))}
                      className="w-full h-9 rounded-md bg-secondary border border-border px-3 text-sm text-foreground font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={closeDecommissionDialog}
                disabled={decommissionDialog.submitting}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={queueDecommissionFromDialog}
                disabled={!canSubmitDecommission || decommissionDialog.submitting}
                className="bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
              >
                {decommissionDialog.submitting
                  ? t('queueing')
                  : (decommissionDialog.dryRun ? t('queueDryRunDecommission') : t('queueLiveDecommission'))}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
