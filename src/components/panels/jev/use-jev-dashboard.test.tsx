import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useJevDashboard } from './use-jev-dashboard'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }))

const status = {
  configured: true, healthy: true, healthError: null, lastCheckedAt: 1,
  assistantAvailable: true, assistantProvider: 'Claude CLI (no tools)',
  defaultModel: 'jev-latest', sdkVersion: '0.5.7', policyCount: 1,
  evaluationCount: 0, successfulCount: 0, lastEvaluationAt: null,
}

describe('useJevDashboard evaluation lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === 'POST' && path === '/api/jev/evaluations') {
        return Promise.resolve({ evaluation: {
          id: 'eval', model: 'jev-1.13.0', answers: {},
          usage: { input_tokens: 1, output_tokens: 1 }, requestId: null, latencyMs: 10,
        } })
      }
      if (path === '/api/jev/status') return Promise.resolve({ status })
      if (path.startsWith('/api/jev/policies')) return Promise.resolve({ policies: [] })
      if (path.startsWith('/api/jev/evaluations')) return Promise.resolve({ evaluations: [] })
      throw new Error(`Unexpected request ${path}`)
    })
  })

  it('returns the visible result without waiting for the background history refresh', async () => {
    const { result } = renderHook(() => useJevDashboard(4))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let evaluation
    await act(async () => { evaluation = await result.current.runEvaluation(7, 'safe context', false) })
    expect(evaluation).toMatchObject({ id: 'eval', model: 'jev-1.13.0' })
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/jev/evaluations', expect.objectContaining({ method: 'POST', timeoutMs: 30_000 }))
  })

  it('refreshes pending cloud status without reloading policies, then stops when synced', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    let reads = 0
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/jev/status') return Promise.resolve({ status: {
        ...status, cloud: { pending: ++reads === 1 ? 2 : 0, state: reads === 1 ? 'pending' : 'synced' },
      } })
      if (path.startsWith('/api/jev/policies')) return Promise.resolve({ policies: [] })
      return Promise.resolve({ evaluations: [] })
    })
    const { result } = renderHook(() => useJevDashboard(4))
    await act(async () => { await Promise.resolve() })
    expect(result.current.status?.cloud.pending).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(result.current.status?.cloud.pending).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(reads).toBe(2)
    expect(mocks.apiFetch.mock.calls.filter(([path]) => path.startsWith('/api/jev/policies'))).toHaveLength(1)
  })

  it('never lets a slow repository response overwrite the newly selected repository', async () => {
    let resolvePolicies: ((value: unknown) => void) | undefined
    let resolveEvaluations: ((value: unknown) => void) | undefined
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/jev/status') return Promise.resolve({ status })
      if (path.includes('projectId=4') && path.includes('/policies')) {
        return new Promise((resolve) => { resolvePolicies = resolve })
      }
      if (path.includes('projectId=4') && path.includes('/evaluations')) {
        return new Promise((resolve) => { resolveEvaluations = resolve })
      }
      if (path.includes('projectId=5') && path.includes('/policies')) {
        return Promise.resolve({ policies: [{ id: 50, project_id: 5, questions: {} }] })
      }
      if (path.includes('projectId=5') && path.includes('/evaluations')) {
        return Promise.resolve({ evaluations: [{ id: 'new', project_id: 5 }] })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    const { result, rerender } = renderHook(({ projectId }) => useJevDashboard(projectId), {
      initialProps: { projectId: 4 },
    })
    rerender({ projectId: 5 })
    await waitFor(() => expect(result.current.policies[0]?.project_id).toBe(5))
    resolvePolicies?.({ policies: [{ id: 40, project_id: 4, questions: {} }] })
    resolveEvaluations?.({ evaluations: [{ id: 'old', project_id: 4 }] })
    await act(async () => { await Promise.resolve() })
    expect(result.current.policies[0]?.project_id).toBe(5)
    expect(result.current.evaluations[0]?.project_id).toBe(5)
  })
})
