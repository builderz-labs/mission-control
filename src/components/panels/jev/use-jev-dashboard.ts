'use client'

import { useCallback, useEffect, useState } from 'react'
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const statusPromise = apiFetch<{ status: JevStatus }>('/api/jev/status')
      if (!projectId) {
        setStatus((await statusPromise).status)
        setPolicies([])
        setEvaluations([])
        return
      }
      const query = `projectId=${projectId}`
      const [statusData, policyData, evaluationData] = await Promise.all([
        statusPromise,
        apiFetch<{ policies: JevPolicy[] }>(`/api/jev/policies?${query}`),
        apiFetch<{ evaluations: JevEvaluation[] }>(`/api/jev/evaluations?${query}`),
      ])
      setStatus(statusData.status)
      setPolicies(policyData.policies)
      setEvaluations(evaluationData.evaluations)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Jev')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const createPolicy = async (input: JevPolicyInput) => {
    if (!projectId) throw new Error('Select a repository first')
    const response = await apiFetch<{ policy: JevPolicy }>('/api/jev/policies', {
      method: 'POST', body: JSON.stringify({ ...input, projectId }),
    })
    await refresh()
    return response.policy
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
      method: 'POST', body: JSON.stringify({ projectId, policyId, state, retainStatePreview }),
    })
    await refresh()
    return response.evaluation
  }

  const loadRepositoryContext = async () => {
    if (!projectId) throw new Error('Select a repository first')
    const response = await apiFetch<{ context: JevRepositoryContext }>(
      `/api/jev/context?projectId=${projectId}`,
    )
    return response.context
  }

  return {
    status, policies, evaluations, loading, error, setError, refresh,
    createPolicy, updatePolicy, deletePolicy, runEvaluation, loadRepositoryContext,
  }
}
