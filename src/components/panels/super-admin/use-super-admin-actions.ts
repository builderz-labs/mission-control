'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useCallback, useState } from 'react'
import type { TenantRow, ProvisionEvent, DecommissionDialogState } from './super-admin-types'

const DIALOG_DEFAULTS: DecommissionDialogState = {
  open: false, tenant: null, dryRun: true,
  removeLinuxUser: false, removeStateDirs: false,
  reason: '', confirmText: '', submitting: false,
}

interface Actions {
  busyJobId: number | null
  decommissionDialog: DecommissionDialogState
  canSubmitDecommission: boolean
  loadJobDetail: (jobId: number) => Promise<void>
  runJob: (jobId: number) => Promise<void>
  approveAndRunJob: (jobId: number) => Promise<void>
  setJobState: (jobId: number, action: 'approve' | 'reject' | 'cancel') => Promise<void>
  openDecommissionDialog: (tenant: TenantRow) => void
  closeDecommissionDialog: () => void
  queueDecommissionFromDialog: () => Promise<void>
  updateDecommissionDialog: (updates: Partial<DecommissionDialogState>) => void
}

interface Deps {
  isLocal: boolean
  localJobEvents: Record<number, ProvisionEvent[]>
  load: () => Promise<void>
  setSelectedJobId: (id: number) => void
  setSelectedJobEvents: (events: ProvisionEvent[]) => void
  setActiveTab: (tab: 'tenants' | 'jobs' | 'events') => void
  setOpenActionMenu: (key: string | null) => void
  showFeedback: (ok: boolean, text: string) => void
}

/** Encapsulates all mutating actions for the super-admin panel. */
export function useSuperAdminActions(deps: Deps): Actions {
  const { isLocal, localJobEvents, load, setSelectedJobId, setSelectedJobEvents, setActiveTab, setOpenActionMenu, showFeedback } = deps

  const [busyJobId, setBusyJobId] = useState<number | null>(null)
  const [decommissionDialog, setDecommissionDialog] = useState<DecommissionDialogState>(DIALOG_DEFAULTS)

  const canSubmitDecommission = !!decommissionDialog.tenant && (
    decommissionDialog.dryRun || decommissionDialog.confirmText.trim() === decommissionDialog.tenant.slug
  )

  const loadJobDetail = useCallback(async (jobId: number) => {
    if (isLocal && jobId < 0) {
      setSelectedJobId(jobId)
      setSelectedJobEvents(localJobEvents[jobId] || [])
      setActiveTab('events')
      return
    }
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to load job details')
      setSelectedJobId(jobId)
      setSelectedJobEvents(Array.isArray(json?.job?.events) ? json.job.events : [])
      setActiveTab('events')
    } catch (e: unknown) {
      showFeedback(false, getErrorMessage(e) || 'Failed to load job details')
    }
  }, [isLocal, localJobEvents, setSelectedJobId, setSelectedJobEvents, setActiveTab, showFeedback])

  const runJob = async (jobId: number) => {
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}/run`, { method: 'POST', signal: AbortSignal.timeout(8000) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to run job')
      showFeedback(true, `Job #${jobId} executed`)
    } catch (e: unknown) { showFeedback(false, getErrorMessage(e) || `Failed to run job #${jobId}`) }
    finally { await load(); await loadJobDetail(jobId); setBusyJobId(null); setOpenActionMenu(null) }
  }

  const approveAndRunJob = async (jobId: number) => {
    setBusyJobId(jobId)
    try {
      const approveRes = await fetch(`/api/super/provision-jobs/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }), signal: AbortSignal.timeout(8000) })
      const approveJson = await approveRes.json().catch(() => ({}))
      if (!approveRes.ok) throw new Error(approveJson?.error || `Failed to approve job #${jobId}`)
      const runRes = await fetch(`/api/super/provision-jobs/${jobId}/run`, { method: 'POST', signal: AbortSignal.timeout(8000) })
      const runJson = await runRes.json().catch(() => ({}))
      if (!runRes.ok) throw new Error(runJson?.error || `Failed to run job #${jobId}`)
      showFeedback(true, `Job #${jobId} approved and executed`)
    } catch (e: unknown) { showFeedback(false, getErrorMessage(e) || `Failed to approve/run job #${jobId}`) }
    finally { await load(); await loadJobDetail(jobId); setBusyJobId(null); setOpenActionMenu(null) }
  }

  const setJobState = async (jobId: number, action: 'approve' | 'reject' | 'cancel') => {
    const reason = window.prompt(`Optional reason for ${action}:`) || undefined
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/super/provision-jobs/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }), signal: AbortSignal.timeout(8000) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Failed to ${action} job`)
      showFeedback(true, `Job #${jobId} ${action}d`)
    } catch (e: unknown) { showFeedback(false, getErrorMessage(e) || `Failed to ${action} job #${jobId}`) }
    finally { await load(); await loadJobDetail(jobId); setBusyJobId(null); setOpenActionMenu(null) }
  }

  const openDecommissionDialog = (tenant: TenantRow) => {
    setOpenActionMenu(null)
    setDecommissionDialog({ ...DIALOG_DEFAULTS, open: true, tenant })
  }

  const closeDecommissionDialog = () => {
    setDecommissionDialog((prev) => ({ ...prev, open: false, submitting: false }))
  }

  const queueDecommissionFromDialog = async () => {
    const { tenant, dryRun, confirmText, removeLinuxUser, removeStateDirs, reason } = decommissionDialog
    if (!tenant) return
    if (!dryRun && confirmText.trim() !== tenant.slug) {
      showFeedback(false, `Type ${tenant.slug} to confirm live decommission`); return
    }
    setDecommissionDialog((prev) => ({ ...prev, submitting: true }))
    try {
      const res = await fetch(`/api/super/tenants/${tenant.id}/decommission`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, remove_linux_user: removeLinuxUser, remove_state_dirs: removeStateDirs, reason: reason.trim() || undefined }),
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Failed to queue decommission job')
      showFeedback(true, `Decommission job queued for ${tenant.slug}${dryRun ? ' (dry-run)' : ''}`)
      closeDecommissionDialog()
      await load()
      const jobId = Number(json?.job?.id || 0)
      if (jobId > 0) await loadJobDetail(jobId)
    } catch (e: unknown) {
      setDecommissionDialog((prev) => ({ ...prev, submitting: false }))
      showFeedback(false, getErrorMessage(e) || `Failed to queue decommission for ${tenant.slug}`)
    }
  }

  const updateDecommissionDialog = (updates: Partial<DecommissionDialogState>) => {
    setDecommissionDialog((prev) => ({ ...prev, ...updates }))
  }

  return { busyJobId, decommissionDialog, canSubmitDecommission, loadJobDetail, runJob, approveAndRunJob, setJobState, openDecommissionDialog, closeDecommissionDialog, queueDecommissionFromDialog, updateDecommissionDialog }
}
