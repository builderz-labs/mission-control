import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuntimeHealthWidget } from '@/components/dashboard/widgets/runtime-health-widget'

describe('RuntimeHealthWidget', () => {
  it('renders Hermes automation and HH recovery status in the visible health panel', () => {
    render(
      <RuntimeHealthWidget
        data={{
          localOsStatus: { value: 'Healthy', status: 'good' },
          claudeHealth: { value: '1 active', status: 'good' },
          codexHealth: { value: '0 active', status: 'warn' },
          hermesHealth: { value: '2 active', status: 'good' },
          hermesRuntime: {
            installed: true,
            gatewayRunning: true,
            activeSessions: 1,
            cronJobCount: 2,
            memoryEntries: 7,
            automation: {
              active: true,
              label: 'Automation active',
              enabledJobs: 2,
              totalJobs: 2,
              latestJobId: 'hh-recovery-nightly',
              latestJobName: 'HH recovery nightly',
              latestRunAt: '2026-03-30T09:30:00.000Z',
            },
            hhRecovery: {
              state: 'success',
              label: 'HH recovery completed',
              detail: 'HH recovery completed successfully.',
              jobId: 'hh-recovery-nightly',
              jobName: 'HH recovery nightly',
              lastRunAt: '2026-03-30T09:30:00.000Z',
            },
          },
          mcHealth: { value: 'Healthy', status: 'good' },
          memPct: 42,
          systemStats: { disk: { usage: '40%' }, uptime: 7200000 },
        } as any}
      />
    )

    expect(screen.getByText('Hermes automation')).toBeTruthy()
    expect(screen.getByText('HH recovery')).toBeTruthy()
    expect(screen.getByText('Automation active')).toBeTruthy()
    expect(screen.getByText('HH recovery completed')).toBeTruthy()
    expect(screen.getByText('2/2 cron jobs')).toBeTruthy()
  })
})
