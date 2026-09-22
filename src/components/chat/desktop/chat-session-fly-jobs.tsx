'use client'

import { useState } from 'react'
import { flyJobsComplete, type SessionFlyJob } from '@/lib/chat-fly-jobs'

export function ChatSessionFlyJobs({ jobs }: { jobs: SessionFlyJob[] }) {
  const complete = flyJobsComplete(jobs)
  const [open, setOpen] = useState(!complete)
  if (jobs.length === 0) return null
  return (
    <div className="ml-7 mr-2 mb-1 rounded-md border border-[var(--chat-border)] bg-black/20 px-2 py-1">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between text-[11px] text-[var(--chat-muted)]"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Fly workers · {jobs.length}</span>
        <span>{complete ? 'complete' : 'live'}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-2 truncate text-[11px] text-[var(--chat-text)]">
              <span className="min-w-0 truncate">{job.title}</span>
              <span className="shrink-0 font-mono opacity-70">{job.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
