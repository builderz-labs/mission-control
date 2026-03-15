import type { KpiData } from './types'

interface TenantKpiCardsProps {
  kpis: KpiData
}

export function TenantKpiCards({ kpis }: TenantKpiCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">Active Tenants</div>
        <div className="text-xl font-semibold text-foreground mt-1">{kpis.active}</div>
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">Pending / In Progress</div>
        <div className="text-xl font-semibold text-foreground mt-1">{kpis.pending}</div>
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">Errored Tenants</div>
        <div className="text-xl font-semibold text-red-400 mt-1">{kpis.errored}</div>
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-xs text-muted-foreground">Queued Approvals</div>
        <div className="text-xl font-semibold text-amber-400 mt-1">{kpis.queuedApprovals}</div>
      </div>
    </div>
  )
}
