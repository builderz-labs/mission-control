'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMissionControl } from '@/store'
import type {
  SuperTab,
  TenantRow,
  ProvisionJob,
  ProvisionEvent,
  DecommissionDialogState,
  GatewayOption,
  SchedulerTask,
  CreateFormState,
  KpiData,
} from './types'
import { TENANT_PAGE_SIZE, JOB_PAGE_SIZE } from './types'

const INITIAL_FORM: CreateFormState = {
  slug: '',
  display_name: '',
  linux_user: '',
  plan_tier: 'standard',
  owner_gateway: 'openclaw-main',
  gateway_port: '',
  dashboard_port: '',
  dry_run: true,
}

const INITIAL_DECOMMISSION: DecommissionDialogState = {
  open: false,
  tenant: null,
  dryRun: true,
  removeLinuxUser: false,
  removeStateDirs: false,
  reason: '',
  confirmText: '',
  submitting: false,
}

export function useTenantData() {
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

  const [decommissionDialog, setDecommissionDialog] = useState<DecommissionDialogState>(INITIAL_DECOMMISSION)

  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM)

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

  const kpis: KpiData = useMemo(() => {
    const active = tenants.filter((t) => t.status === 'active').length
    const pending = tenants.filter((t) => ['pending', 'provisioning', 'decommissioning'].includes(t.status)).length
    const errored = tenants.filter((t) => t.status === 'error').length
    const queuedApprovals = jobs.filter((j) => j.status === 'queued').length
    return { active, pending, errored, queuedApprovals }
  }, [tenants, jobs])

  const createTenant = async () => {
    if (!form.slug.trim() || !form.display_name.trim()) {
      showFeedback(false, 'Slug and display name are required')
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

      showFeedback(true, `Tenant ${form.slug} created. Bootstrap job queued.`)
      setForm(INITIAL_FORM)
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
      showFeedback(true, `Job #${jobId} executed`)
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

      showFeedback(true, `Job #${jobId} approved and executed`)
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
      showFeedback(false, `Type ${tenant.slug} to confirm live decommission`)
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
      showFeedback(true, `Decommission job queued for ${tenant.slug}${decommissionDialog.dryRun ? ' (dry-run)' : ''}`)
      closeDecommissionDialog()
      await load()
      if (jobId > 0) await loadJobDetail(jobId)
    } catch (e: any) {
      setDecommissionDialog((prev) => ({ ...prev, submitting: false }))
      showFeedback(false, e?.message || `Failed to queue decommission for ${tenant.slug}`)
    }
  }

  const setJobState = async (jobId: number, action: 'approve' | 'reject' | 'cancel') => {
    const reason = window.prompt(`Optional reason for ${action}:`) || undefined
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Failed to ${action} job`)
      showFeedback(true, `Job #${jobId} ${action}d`)
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

  return {
    // Auth / mode
    currentUser,
    isLocal,

    // Data
    tenants,
    jobs,
    loading,
    error,
    feedback,
    busyJobId,

    // Tabs
    activeTab,
    setActiveTab,

    // Create form
    createExpanded,
    setCreateExpanded,
    form,
    setForm,
    gatewayOptions,
    gatewayLoadError,
    createTenant,

    // Tenant table
    tenantSearch,
    setTenantSearch,
    tenantStatusFilter,
    setTenantStatusFilter,
    tenantPage,
    setTenantPage,
    statusOptions,
    filteredTenants,
    pagedTenants,
    tenantPages,
    latestByTenant,
    openActionMenu,
    setOpenActionMenu,

    // Job table
    jobSearch,
    setJobSearch,
    jobStatusFilter,
    setJobStatusFilter,
    jobTypeFilter,
    setJobTypeFilter,
    jobPage,
    setJobPage,
    jobStatusOptions,
    jobTypeOptions,
    filteredJobs,
    pagedJobs,
    jobPages,
    selectedJobId,
    runJob,
    approveAndRunJob,
    setJobState,

    // Events
    selectedJobEvents,
    loadJobDetail,

    // Decommission
    decommissionDialog,
    setDecommissionDialog,
    openDecommissionDialog,
    closeDecommissionDialog,
    queueDecommissionFromDialog,
    canSubmitDecommission,

    // KPI
    kpis,

    // Actions
    load,
  }
}

export type TenantDataState = ReturnType<typeof useTenantData>
