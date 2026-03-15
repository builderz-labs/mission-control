import type { TenantRow, ProvisionJob } from './types'

interface TenantTableProps {
  tenantSearch: string
  setTenantSearch: (v: string) => void
  tenantStatusFilter: string
  setTenantStatusFilter: (v: string) => void
  statusOptions: string[]
  pagedTenants: TenantRow[]
  filteredTenants: TenantRow[]
  tenantPage: number
  setTenantPage: (fn: (p: number) => number) => void
  tenantPages: number
  latestByTenant: Map<number, ProvisionJob>
  openActionMenu: string | null
  setOpenActionMenu: (fn: (cur: string | null) => string | null) => void
  isLocal: boolean
  loadJobDetail: (jobId: number) => void
  openDecommissionDialog: (tenant: TenantRow) => void
}

export function TenantTable({
  tenantSearch,
  setTenantSearch,
  tenantStatusFilter,
  setTenantStatusFilter,
  statusOptions,
  pagedTenants,
  filteredTenants,
  tenantPage,
  setTenantPage,
  tenantPages,
  latestByTenant,
  openActionMenu,
  setOpenActionMenu,
  isLocal,
  loadJobDetail,
  openDecommissionDialog,
}: TenantTableProps) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <input
            value={tenantSearch}
            onChange={(e) => setTenantSearch(e.target.value)}
            placeholder="Search tenants"
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
                      <button onClick={() => loadJobDetail(latest.id)} className="text-primary hover:underline">
                        #{latest.id} · {latest.status}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right relative">
                    {isLocal && tenant.id < 0 ? (
                      <span className="text-[11px] text-muted-foreground">Local read-only</span>
                    ) : (
                      <>
                        <button
                          onClick={() => setOpenActionMenu((cur) => (cur === menuKey ? null : menuKey))}
                          className="h-7 px-2 rounded border border-border text-xs hover:bg-secondary/60"
                        >
                          Actions
                        </button>
                        {openActionMenu === menuKey && (
                          <div className="absolute right-3 top-10 z-20 w-44 rounded-md border border-border bg-card shadow-xl text-left">
                            <button
                              onClick={() => openDecommissionDialog(tenant)}
                              className="w-full px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                            >
                              Queue Decommission
                            </button>
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
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No matching tenants.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          disabled={tenantPage <= 1}
          onClick={() => setTenantPage((p) => Math.max(1, p - 1))}
          className="h-7 px-2 rounded border border-border disabled:opacity-50"
        >
          Prev
        </button>
        <span className="text-muted-foreground">Page {tenantPage} / {tenantPages}</span>
        <button
          disabled={tenantPage >= tenantPages}
          onClick={() => setTenantPage((p) => Math.min(tenantPages, p + 1))}
          className="h-7 px-2 rounded border border-border disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}
