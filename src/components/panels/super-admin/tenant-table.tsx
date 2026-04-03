'use client'

import { Button } from '@/components/ui/button'
import type { TenantRow, ProvisionJob, GatewayOption } from './super-admin-types'
import { TENANT_PAGE_SIZE } from './super-admin-types'
import { useEffect, useMemo, useState } from 'react'

interface TenantTableProps {
  tenants: TenantRow[]
  jobs: ProvisionJob[]
  isLocal: boolean
  gatewayOptions: GatewayOption[]
  gatewayLoadError: string | null
  openActionMenu: string | null
  setOpenActionMenu: (key: string | null) => void
  onLoadJobDetail: (jobId: number) => void
  onOpenDecommission: (tenant: TenantRow) => void
}

export function TenantTable({
  tenants,
  jobs,
  isLocal,
  openActionMenu,
  setOpenActionMenu,
  onLoadJobDetail,
  onOpenDecommission,
}: TenantTableProps) {
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantStatusFilter, setTenantStatusFilter] = useState('all')
  const [tenantPage, setTenantPage] = useState(1)

  // Reset page to 1 whenever the active filters change
  useEffect(() => { setTenantPage(1) }, [tenantSearch, tenantStatusFilter])

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(tenants.map((t) => t.status))).sort()
    return ['all', ...values]
  }, [tenants])

  const latestByTenant = useMemo(() => {
    const map = new Map<number, ProvisionJob>()
    for (const job of jobs) {
      if (!map.has(job.tenant_id)) map.set(job.tenant_id, job)
    }
    return map
  }, [jobs])

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase()
    return tenants.filter((tenant) => {
      if (tenantStatusFilter !== 'all' && tenant.status !== tenantStatusFilter) return false
      if (!q) return true
      return [tenant.display_name, tenant.slug, tenant.linux_user, tenant.created_by || '', tenant.owner_gateway || '', tenant.status]
        .join(' ').toLowerCase().includes(q)
    })
  }, [tenants, tenantSearch, tenantStatusFilter])

  const tenantPages = Math.max(1, Math.ceil(filteredTenants.length / TENANT_PAGE_SIZE))
  const pagedTenants = filteredTenants.slice((tenantPage - 1) * TENANT_PAGE_SIZE, tenantPage * TENANT_PAGE_SIZE)

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <input
            value={tenantSearch}
            onChange={(e) => setTenantSearch(e.target.value)}
            placeholder="Search organizations"
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
          Showing {pagedTenants.length} of {filteredTenants.length}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Tenant list</caption>
          <thead>
            <tr className="bg-secondary/30 border-b border-border">
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Tenant</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">System User</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Owner</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Status</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Latest Job</th>
              <th scope="col" className="text-right px-3 py-2 text-xs text-muted-foreground">Action</th>
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
                    <div className="text-foreground">{tenant.owner_gateway || 'unassigned'}</div>
                    <div className="text-[11px] text-muted-foreground">by {tenant.created_by || 'unknown'}</div>
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
                      <Button variant="link" size="xs" onClick={() => onLoadJobDetail(latest.id)} className="p-0 h-auto">
                        #{latest.id} · {latest.status}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right relative">
                    {isLocal && tenant.id < 0 ? (
                      <span className="text-[11px] text-muted-foreground">Local read-only</span>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setOpenActionMenu(openActionMenu === menuKey ? null : menuKey)}
                        >
                          Actions
                        </Button>
                        {openActionMenu === menuKey && (
                          <div className="absolute right-3 top-10 z-20 w-44 rounded-md border border-border bg-card shadow-xl text-left">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onOpenDecommission(tenant)}
                              className="w-full justify-start text-xs text-red-300 hover:bg-red-500/10 rounded-none"
                            >
                              Queue Decommission
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
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No matching organizations.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <Button variant="outline" size="xs" disabled={tenantPage <= 1} onClick={() => setTenantPage((p) => Math.max(1, p - 1))}>Prev</Button>
        <span className="text-muted-foreground">Page {tenantPage} / {tenantPages}</span>
        <Button variant="outline" size="xs" disabled={tenantPage >= tenantPages} onClick={() => setTenantPage((p) => Math.min(tenantPages, p + 1))}>Next</Button>
      </div>
    </div>
  )
}
