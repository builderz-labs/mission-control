'use client'

import {
  TenantKpiCards,
  TenantTable,
  TenantCreateForm,
  JobTable,
  EventLog,
  DecommissionDialog,
} from './super-admin'
import { useTenantData } from './super-admin/use-tenant-data'
import type { SuperTab } from './super-admin/types'

export function SuperAdminPanel() {
  const state = useTenantData()

  if (state.currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">Access Denied</div>
        <p className="text-sm text-muted-foreground">Super Mission Control requires admin privileges.</p>
      </div>
    )
  }

  if (state.loading) {
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
          <h2 className="text-lg font-semibold text-foreground">Super Mission Control</h2>
          <p className="text-sm text-muted-foreground">
            {state.isLocal
              ? 'Local control plane view over scheduler automations and runtime state.'
              : 'Multi-tenant provisioning control plane with approval gates and safer destructive actions.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => state.setCreateExpanded(true)}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth"
          >
            + Add Workspace
          </button>
          <button
            onClick={state.load}
            className="h-8 px-3 rounded-md border border-border text-sm text-foreground hover:bg-secondary/60 transition-smooth"
          >
            Refresh
          </button>
        </div>
      </div>

      <TenantKpiCards kpis={state.kpis} />

      {state.feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${
          state.feedback.ok
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {state.feedback.text}
        </div>
      )}

      {state.error && (
        <div className="px-3 py-2 rounded-md text-sm border bg-red-500/10 text-red-400 border-red-500/20">
          {state.error}
        </div>
      )}

      {state.createExpanded && (
        <TenantCreateForm
          form={state.form}
          setForm={state.setForm}
          gatewayOptions={state.gatewayOptions}
          gatewayLoadError={state.gatewayLoadError}
          createTenant={state.createTenant}
          setCreateExpanded={state.setCreateExpanded}
        />
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          {(['tenants', 'jobs', 'events'] as SuperTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => state.setActiveTab(tab)}
              className={`h-8 px-3 rounded-md text-sm capitalize ${
                state.activeTab === tab
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground border border-transparent hover:bg-secondary/40'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {state.activeTab === 'tenants' && (
          <TenantTable
            tenantSearch={state.tenantSearch}
            setTenantSearch={state.setTenantSearch}
            tenantStatusFilter={state.tenantStatusFilter}
            setTenantStatusFilter={state.setTenantStatusFilter}
            statusOptions={state.statusOptions}
            pagedTenants={state.pagedTenants}
            filteredTenants={state.filteredTenants}
            tenantPage={state.tenantPage}
            setTenantPage={state.setTenantPage}
            tenantPages={state.tenantPages}
            latestByTenant={state.latestByTenant}
            openActionMenu={state.openActionMenu}
            setOpenActionMenu={state.setOpenActionMenu}
            isLocal={state.isLocal}
            loadJobDetail={state.loadJobDetail}
            openDecommissionDialog={state.openDecommissionDialog}
          />
        )}

        {state.activeTab === 'jobs' && (
          <JobTable
            jobSearch={state.jobSearch}
            setJobSearch={state.setJobSearch}
            jobStatusFilter={state.jobStatusFilter}
            setJobStatusFilter={state.setJobStatusFilter}
            jobTypeFilter={state.jobTypeFilter}
            setJobTypeFilter={state.setJobTypeFilter}
            jobStatusOptions={state.jobStatusOptions}
            jobTypeOptions={state.jobTypeOptions}
            pagedJobs={state.pagedJobs}
            filteredJobs={state.filteredJobs}
            jobPage={state.jobPage}
            setJobPage={state.setJobPage}
            jobPages={state.jobPages}
            selectedJobId={state.selectedJobId}
            busyJobId={state.busyJobId}
            openActionMenu={state.openActionMenu}
            setOpenActionMenu={state.setOpenActionMenu}
            isLocal={state.isLocal}
            loadJobDetail={state.loadJobDetail}
            runJob={state.runJob}
            approveAndRunJob={state.approveAndRunJob}
            setJobState={state.setJobState}
          />
        )}

        {state.activeTab === 'events' && (
          <EventLog
            selectedJobId={state.selectedJobId}
            selectedJobEvents={state.selectedJobEvents}
          />
        )}
      </div>

      <DecommissionDialog
        decommissionDialog={state.decommissionDialog}
        setDecommissionDialog={state.setDecommissionDialog}
        closeDecommissionDialog={state.closeDecommissionDialog}
        queueDecommissionFromDialog={state.queueDecommissionFromDialog}
        canSubmitDecommission={state.canSubmitDecommission}
      />
    </div>
  )
}
