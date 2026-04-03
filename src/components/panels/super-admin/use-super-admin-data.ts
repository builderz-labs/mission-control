'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TenantRow, ProvisionJob, ProvisionEvent, GatewayOption, SchedulerTask } from './super-admin-types'

interface SuperAdminData {
  tenants: TenantRow[]
  jobs: ProvisionJob[]
  localJobEvents: Record<number, ProvisionEvent[]>
  gatewayOptions: GatewayOption[]
  gatewayLoadError: string | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
}

/** Encapsulates all data-fetching for the super-admin panel, including local scheduler synthesis. */
export function useSuperAdminData(isLocal: boolean, currentUsername?: string): SuperAdminData {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [jobs, setJobs] = useState<ProvisionJob[]>([])
  const [localJobEvents, setLocalJobEvents] = useState<Record<number, ProvisionEvent[]>>({})
  const [gatewayOptions, setGatewayOptions] = useState<GatewayOption[]>([])
  const [gatewayLoadError, setGatewayLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

      let tenantRows: TenantRow[] = Array.isArray(tenantsJson?.tenants) ? tenantsJson.tenants : []
      let jobRows: ProvisionJob[] = Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : []
      const gatewayRows = Array.isArray(gatewaysJson?.gateways) ? gatewaysJson.gateways : []
      const schedulerTasks: SchedulerTask[] = Array.isArray(schedulerJson?.tasks) ? schedulerJson.tasks : []
      const localEvents: Record<number, ProvisionEvent[]> = {}

      if (isLocal) {
        if (tenantRows.length === 0) {
          const primaryGateway = gatewayRows.find((gw: GatewayOption) => Number(gw?.is_primary) === 1)
          const now = Math.floor(Date.now() / 1000)
          tenantRows = [{
            id: -1, slug: 'local-system', display_name: 'Local Ultron',
            linux_user: currentUsername || 'local', created_by: 'local',
            owner_gateway: primaryGateway?.name || 'local', status: 'active',
            plan_tier: 'local', gateway_port: Number(primaryGateway?.port || 0) || null,
            dashboard_port: null, created_at: now, latest_job_id: null, latest_job_status: null,
          }]
        }

        if (jobRows.length === 0 && schedulerTasks.length > 0) {
          jobRows = schedulerTasks.map((task: SchedulerTask, index: number) => {
            const id = -1000 - index
            const status = task.running ? 'running'
              : (!task.enabled ? 'cancelled'
                : (task.lastResult?.ok === false ? 'failed' : (task.lastRun ? 'completed' : 'queued')))
            const eventRows: ProvisionEvent[] = []
            if (task.lastResult) {
              eventRows.push({ id: id * -10, level: task.lastResult.ok ? 'info' : 'error', step_key: task.id, message: task.lastResult.message, created_at: Math.floor(task.lastResult.timestamp / 1000) })
            }
            eventRows.push({ id: id * -10 + 1, level: 'info', step_key: task.id, message: `Next run: ${new Date(task.nextRun).toLocaleString()}`, created_at: Math.floor(Date.now() / 1000) })
            localEvents[id] = eventRows
            const lastRunSec = task.lastRun ? Math.floor(task.lastRun / 1000) : null
            return { id, tenant_id: -1, tenant_slug: 'local-system', tenant_display_name: 'Local Ultron', job_type: 'automation', status, dry_run: 1, requested_by: 'scheduler', approved_by: null, started_at: lastRunSec, completed_at: status !== 'running' ? lastRunSec : null, error_text: task.lastResult?.ok === false ? task.lastResult.message : null, created_at: lastRunSec || Math.floor(task.nextRun / 1000) } as ProvisionJob
          })
        }
      }

      setTenants(tenantRows)
      setJobs(jobRows)
      setLocalJobEvents(localEvents)
      setGatewayOptions(gatewayRows.map((g: GatewayOption) => ({ id: Number(g.id), name: String(g.name), status: g.status, is_primary: g.is_primary })))
      setGatewayLoadError(gatewaysRes.ok ? null : (gatewaysJson?.error || 'Failed to load gateways'))
      setError(null)
    } catch (e: unknown) {
      setError(getErrorMessage(e) || 'Failed to load super admin data')
    } finally {
      setLoading(false)
    }
  }, [isLocal, currentUsername])

  // Poll every 10 seconds; start immediately on mount
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    loadRef.current()
    const id = setInterval(() => loadRef.current(), 10000)
    return () => clearInterval(id)
  }, [])

  return { tenants, jobs, localJobEvents, gatewayOptions, gatewayLoadError, loading, error, load }
}
