import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  isHermesInstalledMock: vi.fn(),
  isHermesGatewayRunningMock: vi.fn(),
  scanHermesSessionsMock: vi.fn(),
  getHermesTasksMock: vi.fn(),
  getHermesMemoryMock: vi.fn(),
}))

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: mocks.isHermesInstalledMock,
  isHermesGatewayRunning: mocks.isHermesGatewayRunningMock,
  scanHermesSessions: mocks.scanHermesSessionsMock,
}))

vi.mock('@/lib/hermes-tasks', () => ({
  getHermesTasks: mocks.getHermesTasksMock,
}))

vi.mock('@/lib/hermes-memory', () => ({
  getHermesMemory: mocks.getHermesMemoryMock,
}))

import { getHermesRuntimeStatus } from '@/lib/hermes-runtime'

describe('getHermesRuntimeStatus', () => {
  beforeEach(() => {
    mocks.isHermesInstalledMock.mockReset()
    mocks.isHermesGatewayRunningMock.mockReset()
    mocks.scanHermesSessionsMock.mockReset()
    mocks.getHermesTasksMock.mockReset()
    mocks.getHermesMemoryMock.mockReset()
  })

  it('summarizes active Hermes automation and the latest HH recovery outcome', () => {
    mocks.isHermesInstalledMock.mockReturnValue(true)
    mocks.isHermesGatewayRunningMock.mockReturnValue(true)
    mocks.scanHermesSessionsMock.mockReturnValue([
      { isActive: true },
      { isActive: false },
    ])
    mocks.getHermesTasksMock.mockReturnValue({
      cronJobs: [
        {
          id: 'daily-maintenance',
          name: 'Daily maintenance',
          prompt: 'Run daily maintenance checks',
          enabled: true,
          lastRunAt: '2026-03-30T01:00:00.000Z',
          lastOutput: 'Maintenance completed.',
          createdAt: '2026-03-29T01:00:00.000Z',
        },
        {
          id: 'hh-recovery-nightly',
          name: 'HH recovery nightly',
          prompt: 'Run the Holy Hedgehog recovery loop',
          enabled: true,
          lastRunAt: '2026-03-30T09:30:00.000Z',
          lastOutput: 'HH recovery completed successfully.',
          createdAt: '2026-03-29T01:00:00.000Z',
        },
      ],
    })
    mocks.getHermesMemoryMock.mockReturnValue({
      agentMemoryEntries: 7,
    })

    const status = getHermesRuntimeStatus()

    expect(status.installed).toBe(true)
    expect(status.gatewayRunning).toBe(true)
    expect(status.activeSessions).toBe(1)
    expect(status.cronJobCount).toBe(2)
    expect(status.memoryEntries).toBe(7)
    expect(status.automation.active).toBe(true)
    expect(status.automation.label).toBe('Automation active')
    expect(status.automation.enabledJobs).toBe(2)
    expect(status.automation.latestJobId).toBe('hh-recovery-nightly')
    expect(status.hhRecovery.state).toBe('success')
    expect(status.hhRecovery.label).toBe('HH recovery completed')
    expect(status.hhRecovery.detail).toContain('completed successfully')
    expect(status.hhRecovery.jobId).toBe('hh-recovery-nightly')
  })

  it('reports a missing HH recovery job without inventing a status', () => {
    mocks.isHermesInstalledMock.mockReturnValue(true)
    mocks.isHermesGatewayRunningMock.mockReturnValue(false)
    mocks.scanHermesSessionsMock.mockReturnValue([])
    mocks.getHermesTasksMock.mockReturnValue({
      cronJobs: [
        {
          id: 'daily-maintenance',
          name: 'Daily maintenance',
          prompt: 'Run daily maintenance checks',
          enabled: false,
          lastRunAt: null,
          lastOutput: 'Maintenance completed.',
          createdAt: '2026-03-29T01:00:00.000Z',
        },
      ],
    })
    mocks.getHermesMemoryMock.mockReturnValue({
      agentMemoryEntries: 0,
    })

    const status = getHermesRuntimeStatus()

    expect(status.automation.active).toBe(false)
    expect(status.automation.label).toBe('Automation idle')
    expect(status.hhRecovery.state).toBe('missing')
    expect(status.hhRecovery.label).toBe('No HH recovery job found')
  })
})
