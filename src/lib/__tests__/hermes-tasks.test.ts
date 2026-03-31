import { describe, expect, it } from 'vitest'

describe('getHermesTasks', () => {
  it('reads cron jobs from the live Hermes object-style jobs.json format', async () => {
    const { getHermesTasks } = await import('@/lib/hermes-tasks')
    const result = getHermesTasks(true)

    expect(result.cronJobs.length).toBeGreaterThan(0)
    expect(result.cronJobs.some((job) => job.id === '60f3e0e16db2')).toBe(true)
    expect(result.cronJobs.some((job) => job.schedule === '0 3 * * *')).toBe(true)
  })
})
