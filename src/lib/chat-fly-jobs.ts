import type { FlyActivityJob } from './fly-activity'

export type SessionFlyJob = {
  id: string
  title: string
  state: string
}

export function withSessionFlyJobs<T extends { id: string }>(
  sessions: T[],
  jobs: FlyActivityJob[],
): Array<T & { flyJobs: SessionFlyJob[] }> {
  return sessions.map((session) => ({ ...session, flyJobs: jobsForSession(jobs, session.id) }))
}

export function jobsForSession(jobs: FlyActivityJob[], sessionId: string): SessionFlyJob[] {
  return jobs
    .filter((job) => job.session_id && sessionMatchesFly(sessionId, job.session_id))
    .map((job) => ({ id: job.id, title: job.title, state: job.state }))
}

export function flyJobsComplete(jobs: SessionFlyJob[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.state === 'succeeded' || job.state === 'failed')
}

function sessionMatchesFly(sessionId: string, flySessionId: string): boolean {
  return sessionId === flySessionId || sessionId.includes(flySessionId) || flySessionId.includes(sessionId)
}
