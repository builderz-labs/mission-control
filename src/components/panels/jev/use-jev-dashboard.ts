'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type {
  JevEvaluation,
  JevPolicy,
  JevPolicyInput,
  JevRepositoryContext,
  JevRunResult,
  JevState,
  JevStatus,
} from './jev-ui-types'

export function useJevDashboard(projectId: number | null) {
  const [status, setStatus] = useState<JevStatus | null>(null)
  const [policies, setPolicies] = useState<JevPolicy[]>([])
  const [evaluations, setEvaluations] = useState<JevEvaluation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const requestId = ++requestRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const options = { signal: controller.signal }
      const statusPromise = apiFetch<{ status: JevStatus }>('/api/jev/status', options)
      if (!projectId) {
        const nextStatus = (await statusPromise).status
        if (requestId !== requestRef.current) return false
        setStatus(nextStatus)
        setPolicies([])
        setEvaluations([])
        return true
      }
      const query = `projectId=${projectId}`
      const [statusData, policyData, evaluationData] = await Promise.all([
        statusPromise,
        apiFetch<{ policies: JevPolicy[] }>(`/api/jev/policies?${query}`, options),
        apiFetch<{ evaluations: JevEvaluation[] }>(`/api/jev/evaluations?${query}&limit=200`, options),
      ])
      if (requestId !== requestRef.current) return false
      setStatus(statusData.status)
      setPolicies(policyData.policies)
      setEvaluations(evaluationData.evaluations)
      setError(null)
      return true
    } catch (cause) {
      if (requestId !== requestRef.current || (cause instanceof Error && cause.name === 'AbortError')) return false
      setError(cause instanceof Error ? cause.message : 'Unable to load Jev')
      return false
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        abortRef.current = null
      }
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
    return () => {
      requestRef.current += 1
      abortRef.current?.abort()
    }
  }, [refresh])

  // Sync finishes after the write response. Refresh only status, not the user's draft.
  useEffect(() => {
    if (!status?.cloud?.pending) return
    const controller = new AbortController()
    let inFlight = false
    const timer = setInterval(async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      try {
        const next = await apiFetch<{ status: JevStatus }>('/api/jev/status', { signal: controller.signal })
        if (!controller.signal.aborted) setStatus(next.status)
      } catch { /* Preserve the last truthful status; the next visible poll retries. */ }
      finally { inFlight = false }
    }, 15_000)
    return () => { clearInterval(timer); controller.abort() }
  }, [projectId, status?.cloud?.pending])

  const createPolicy = async (input: JevPolicyInput) => {
    if (!projectId) throw new Error('Select a repository first')
    const response = await apiFetch<{ policy: JevPolicy }>('/api/jev/policies', {
      method: 'POST', body: JSON.stringify({ ...input, projectId }),
    })
    await refresh()
    return response.policy
  }

  const createPolicies = async (
    input: JevPolicyInput,
    projectIds: number[],
    approval?: { sessionId: string; expectedRevisionNo: number },
  ) => {
    const response = await apiFetch<{ policies: JevPolicy[] }>('/api/jev/policies/bulk', {
      method: 'POST', body: JSON.stringify({ ...input, projectIds, approval }),
    })
    await refresh()
    return response.policies
  }

  const updatePolicy = async (id: number, input: Partial<JevPolicyInput>) => {
    if (!projectId) return
    await apiFetch(`/api/jev/policies/${id}`, {
      method: 'PATCH', body: JSON.stringify({ ...input, projectId }),
    })
    await refresh()
  }

  const deletePolicy = async (id: number) => {
    if (!projectId) return
    await apiFetch(`/api/jev/policies/${id}?projectId=${projectId}`, { method: 'DELETE' })
    await refresh()
  }

  const runEvaluation = async (policyId: number, state: JevState, retainStatePreview: boolean) => {
    if (!projectId) throw new Error('Select a repository first')
    const response = await apiFetch<{ evaluation: JevRunResult }>('/api/jev/evaluations', {
      method: 'POST', timeoutMs: 30_000, body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(), projectId, policyId, state, retainStatePreview,
      }),
    })
    void refresh()
    return response.evaluation
  }

  const loadRepositoryContext = async (policyId: number) => {
    if (!projectId) throw new Error('Select a repository first')
    const response = await apiFetch<{ context: JevRepositoryContext }>(
      `/api/jev/context?projectId=${projectId}&policyId=${policyId}`,
    )
    return response.context
  }

  return {
    status, policies, evaluations, loading, error, setError, refresh,
    createPolicy, createPolicies, updatePolicy, deletePolicy, runEvaluation, loadRepositoryContext,
  }
}
