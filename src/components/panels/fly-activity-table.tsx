import type { FlyActivity } from '@/lib/fly-activity'

/** Accessible job-level counterpart to the high-level placement flow. */
export function FlyActivityTable({ activity }: { activity?: FlyActivity }) {
  if (!activity) return null
  return <section className="space-y-2" aria-labelledby="fly-jobs-title">
    <h3 id="fly-jobs-title" className="text-sm font-medium">Jobs · latest 100 attempts</h3>
    <p className="text-xs text-muted-foreground">Oldest queued: {activity.oldest_queue_seconds}s · {activity.states.succeeded || 0} succeeded · {activity.states.failed || 0} failed · {activity.states.cancelled || 0} cancelled. Session totals are available in the matching chat.</p>
    <div className="max-h-80 overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-card"><tr>{['Task / session', 'State / worker', 'Runtime', 'CPU / RAM', 'Compute estimate'].map(label => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{activity.jobs.length ? activity.jobs.map(job => {
          const fresh = job.heartbeat_at !== null && job.heartbeat_at >= Math.floor(Date.now()/1000)-90
          return <tr key={job.id} className="border-t border-border">
            <td className="max-w-64 break-words p-3">#{job.task_id} {job.title}<span className="block text-muted-foreground">{job.session_id || 'Unlinked session'}</span></td>
            <td className="p-3">{job.state}<span className="block text-muted-foreground">{job.image_kind} · {job.machine_id || 'Pending identity'}</span></td>
            <td className="p-3 tabular-nums">{job.runtime_seconds}s</td>
            <td className="p-3 tabular-nums">{fresh && job.cpu_percent !== null ? `${job.cpu_percent.toFixed(0)}%` : '—'} / {fresh && job.memory_bytes !== null ? `${(job.memory_bytes/1048576).toFixed(0)} MB` : '—'}</td>
            <td className="p-3 tabular-nums">${job.observed_cost_usd.toFixed(4)}<span className="block text-muted-foreground">${job.estimated_cost_usd.toFixed(4)} reserved ceiling</span></td>
          </tr>
        }) : <tr><td colSpan={5} className="p-3 text-muted-foreground">No worker attempts recorded.</td></tr>}</tbody>
      </table>
    </div>
  </section>
}
