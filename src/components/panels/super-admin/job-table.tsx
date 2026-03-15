import type { ProvisionJob } from './types'

interface JobTableProps {
  jobSearch: string
  setJobSearch: (v: string) => void
  jobStatusFilter: string
  setJobStatusFilter: (v: string) => void
  jobTypeFilter: string
  setJobTypeFilter: (v: string) => void
  jobStatusOptions: string[]
  jobTypeOptions: string[]
  pagedJobs: ProvisionJob[]
  filteredJobs: ProvisionJob[]
  jobPage: number
  setJobPage: (fn: (p: number) => number) => void
  jobPages: number
  selectedJobId: number | null
  busyJobId: number | null
  openActionMenu: string | null
  setOpenActionMenu: (fn: (cur: string | null) => string | null) => void
  isLocal: boolean
  loadJobDetail: (jobId: number) => void
  runJob: (jobId: number) => void
  approveAndRunJob: (jobId: number) => void
  setJobState: (jobId: number, action: 'approve' | 'reject' | 'cancel') => void
}

export function JobTable({
  jobSearch,
  setJobSearch,
  jobStatusFilter,
  setJobStatusFilter,
  jobTypeFilter,
  setJobTypeFilter,
  jobStatusOptions,
  jobTypeOptions,
  pagedJobs,
  filteredJobs,
  jobPage,
  setJobPage,
  jobPages,
  selectedJobId,
  busyJobId,
  openActionMenu,
  setOpenActionMenu,
  isLocal,
  loadJobDetail,
  runJob,
  approveAndRunJob,
  setJobState,
}: JobTableProps) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
            placeholder="Search jobs"
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
          Showing {pagedJobs.length} of {filteredJobs.length}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Provisioning jobs</caption>
          <thead>
            <tr className="bg-secondary/30 border-b border-border">
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Job</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Tenant</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Status</th>
              <th scope="col" className="text-left px-3 py-2 text-xs text-muted-foreground">Requested/Approved</th>
              <th scope="col" className="text-right px-3 py-2 text-xs text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedJobs.map((job) => {
              const menuKey = `job-${job.id}`
              return (
                <tr key={job.id} className={`border-b border-border/50 last:border-0 ${selectedJobId === job.id ? 'bg-primary/10' : 'hover:bg-secondary/20'}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => loadJobDetail(job.id)} className="text-primary hover:underline text-xs">
                      #{job.id}
                    </button>
                    <div className="text-[11px] text-muted-foreground">{job.job_type} {job.dry_run ? '(dry)' : '(live)'}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{job.tenant_slug || job.tenant_id}</td>
                  <td className="px-3 py-2 text-xs">{job.status}</td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    <div>Req: {job.requested_by}</div>
                    <div>Appr: {job.approved_by || '-'}</div>
                  </td>
                  <td className="px-3 py-2 text-right relative">
                    {isLocal && job.id < 0 ? (
                      <button
                        onClick={() => loadJobDetail(job.id)}
                        className="h-7 px-2 rounded border border-border text-xs hover:bg-secondary/60"
                      >
                        View
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setOpenActionMenu((cur) => (cur === menuKey ? null : menuKey))}
                          className="h-7 px-2 rounded border border-border text-xs hover:bg-secondary/60"
                        >
                          Actions
                        </button>
                        {openActionMenu === menuKey && (
                          <div className="absolute right-3 top-10 z-20 w-40 rounded-md border border-border bg-card shadow-xl text-left">
                            <button
                              onClick={() => loadJobDetail(job.id)}
                              className="w-full px-3 py-2 text-xs text-foreground hover:bg-secondary/40"
                            >
                              View events
                            </button>
                            <button
                              onClick={() => Number(job.dry_run) === 1 ? approveAndRunJob(job.id) : setJobState(job.id, 'approve')}
                              disabled={busyJobId === job.id || !['queued', 'rejected', 'failed'].includes(job.status)}
                              className="w-full px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                            >
                              {Number(job.dry_run) === 1 ? 'Approve + Run' : 'Approve'}
                            </button>
                            <button
                              onClick={() => setJobState(job.id, 'reject')}
                              disabled={busyJobId === job.id || !['queued', 'approved', 'failed'].includes(job.status)}
                              className="w-full px-3 py-2 text-xs text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => runJob(job.id)}
                              disabled={busyJobId === job.id || job.status !== 'approved'}
                              className="w-full px-3 py-2 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
                            >
                              {busyJobId === job.id ? 'Running...' : 'Run'}
                            </button>
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
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No matching jobs.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          disabled={jobPage <= 1}
          onClick={() => setJobPage((p) => Math.max(1, p - 1))}
          className="h-7 px-2 rounded border border-border disabled:opacity-50"
        >
          Prev
        </button>
        <span className="text-muted-foreground">Page {jobPage} / {jobPages}</span>
        <button
          disabled={jobPage >= jobPages}
          onClick={() => setJobPage((p) => Math.min(jobPages, p + 1))}
          className="h-7 px-2 rounded border border-border disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}
