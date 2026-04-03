'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ProvisionJob } from './super-admin-types'
import { JOB_PAGE_SIZE } from './super-admin-types'

interface JobsTableProps {
  jobs: ProvisionJob[]
  isLocal: boolean
  selectedJobId: number | null
  busyJobId: number | null
  openActionMenu: string | null
  setOpenActionMenu: (key: string | null) => void
  onLoadJobDetail: (jobId: number) => void
  onApproveAndRun: (jobId: number) => void
  onSetJobState: (jobId: number, action: 'approve' | 'reject' | 'cancel') => void
  onRunJob: (jobId: number) => void
}

export function JobsTable({
  jobs,
  isLocal,
  selectedJobId,
  busyJobId,
  openActionMenu,
  setOpenActionMenu,
  onLoadJobDetail,
  onApproveAndRun,
  onSetJobState,
  onRunJob,
}: JobsTableProps) {
  const [jobSearch, setJobSearch] = useState('')
  const [jobStatusFilter, setJobStatusFilter] = useState('all')
  const [jobTypeFilter, setJobTypeFilter] = useState('all')
  const [jobPage, setJobPage] = useState(1)

  // Reset page to 1 whenever the active filters change
  useEffect(() => { setJobPage(1) }, [jobSearch, jobStatusFilter, jobTypeFilter])

  const jobStatusOptions = useMemo(() => {
    const values = Array.from(new Set(jobs.map((j) => j.status))).sort()
    return ['all', ...values]
  }, [jobs])

  const jobTypeOptions = useMemo(() => {
    const values = Array.from(new Set(jobs.map((j) => j.job_type))).sort()
    return ['all', ...values]
  }, [jobs])

  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase()
    return jobs.filter((job) => {
      if (jobStatusFilter !== 'all' && job.status !== jobStatusFilter) return false
      if (jobTypeFilter !== 'all' && job.job_type !== jobTypeFilter) return false
      if (!q) return true
      return [String(job.id), job.tenant_slug || '', String(job.tenant_id), job.requested_by, job.approved_by || '', job.status, job.job_type]
        .join(' ').toLowerCase().includes(q)
    })
  }, [jobs, jobSearch, jobStatusFilter, jobTypeFilter])

  const jobPages = Math.max(1, Math.ceil(filteredJobs.length / JOB_PAGE_SIZE))
  const pagedJobs = filteredJobs.slice((jobPage - 1) * JOB_PAGE_SIZE, jobPage * JOB_PAGE_SIZE)

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
            {jobStatusOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            value={jobTypeFilter}
            onChange={(e) => setJobTypeFilter(e.target.value)}
            className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground"
          >
            {jobTypeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div className="text-xs text-muted-foreground">Showing {pagedJobs.length} of {filteredJobs.length}</div>
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
                    <Button variant="link" size="xs" onClick={() => onLoadJobDetail(job.id)} className="p-0 h-auto">
                      #{job.id}
                    </Button>
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
                      <Button variant="outline" size="xs" onClick={() => onLoadJobDetail(job.id)}>View</Button>
                    ) : (
                      <>
                        <Button variant="outline" size="xs" onClick={() => setOpenActionMenu(openActionMenu === menuKey ? null : menuKey)}>
                          Actions
                        </Button>
                        {openActionMenu === menuKey && (
                          <div className="absolute right-3 top-10 z-20 w-40 rounded-md border border-border bg-card shadow-xl text-left">
                            <Button variant="ghost" size="sm" onClick={() => onLoadJobDetail(job.id)} className="w-full justify-start text-xs rounded-none">
                              View events
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => Number(job.dry_run) === 1 ? onApproveAndRun(job.id) : onSetJobState(job.id, 'approve')}
                              disabled={busyJobId === job.id || !['queued', 'rejected', 'failed'].includes(job.status)}
                              className="w-full justify-start text-xs text-emerald-400 hover:bg-emerald-500/10 rounded-none"
                            >
                              {Number(job.dry_run) === 1 ? 'Approve + Run' : 'Approve'}
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => onSetJobState(job.id, 'reject')}
                              disabled={busyJobId === job.id || !['queued', 'approved', 'failed'].includes(job.status)}
                              className="w-full justify-start text-xs text-amber-400 hover:bg-amber-500/10 rounded-none"
                            >
                              Reject
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => onRunJob(job.id)}
                              disabled={busyJobId === job.id || job.status !== 'approved'}
                              className="w-full justify-start text-xs text-primary hover:bg-primary/10 rounded-none"
                            >
                              {busyJobId === job.id ? 'Running...' : 'Run'}
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
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No matching jobs.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <Button variant="outline" size="xs" disabled={jobPage <= 1} onClick={() => setJobPage((p) => Math.max(1, p - 1))}>Prev</Button>
        <span className="text-muted-foreground">Page {jobPage} / {jobPages}</span>
        <Button variant="outline" size="xs" disabled={jobPage >= jobPages} onClick={() => setJobPage((p) => Math.min(jobPages, p + 1))}>Next</Button>
      </div>
    </div>
  )
}
