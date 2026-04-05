'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { getErrorMessage } from '@/lib/types/sql'
import { type UserRecord, type AccessRequest, type CreateFormState, type EditFormState, type ReviewFormState } from './types'

interface UseUserManagementReturn {
  users: UserRecord[]
  requests: AccessRequest[]
  loading: boolean
  error: string | null
  feedback: { ok: boolean; text: string } | null
  pendingRequests: AccessRequest[]
  creating: boolean
  saving: boolean
  processingRequestId: number | null
  fetchAll: () => Promise<void>
  handleCreate: (form: CreateFormState, onSuccess: () => void) => Promise<void>
  handleEdit: (editingId: number, editForm: EditFormState, onSuccess: () => void) => Promise<void>
  handleDelete: (u: UserRecord, currentUserId: number | undefined) => Promise<void>
  submitReview: (requestId: number, action: 'approve' | 'reject', reviewForm: ReviewFormState, onSuccess: () => void) => Promise<void>
}

export function useUserManagement(): UseUserManagementReturn {
  const t = useTranslations('userManagement')
  const [users, setUsers] = useState<UserRecord[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(null)

  // Prevent setState after unmount on feedback auto-dismiss
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = (ok: boolean, text: string): void => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback({ ok, text })
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3200)
  }

  useEffect(() => {
    return () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }
  }, [])

  const fetchAll = useCallback(async (): Promise<void> => {
    try {
      const [uRes, rRes] = await Promise.all([
        fetch('/api/auth/users', { cache: 'no-store' }),
        fetch('/api/auth/access-requests?status=all', { cache: 'no-store' }),
      ])
      if (uRes.status === 403 || rRes.status === 403) {
        setError(t('adminAccessRequired'))
        return
      }
      const uJson = await uRes.json().catch(() => ({}))
      const rJson = await rRes.json().catch(() => ({}))
      setUsers(Array.isArray(uJson?.users) ? uJson.users : [])
      setRequests(Array.isArray(rJson?.requests) ? rJson.requests : [])
      setError(null)
    } catch {
      setError(t('failedToLoadUsers'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleCreate = async (form: CreateFormState, onSuccess: () => void): Promise<void> => {
    if (!form.username || !form.password) return
    setCreating(true)
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        showFeedback(true, t('createdUser', { username: form.username }))
        onSuccess()
        fetchAll()
      } else {
        showFeedback(false, data.error || t('failedToCreate'))
      }
    } catch {
      showFeedback(false, t('networkError'))
    } finally {
      setCreating(false)
    }
  }

  const handleEdit = async (editingId: number, editForm: EditFormState, onSuccess: () => void): Promise<void> => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { id: editingId }
      if (editForm.display_name) body.display_name = editForm.display_name
      if (editForm.role) body.role = editForm.role
      if (editForm.password) body.password = editForm.password
      const res = await fetch('/api/auth/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        showFeedback(true, t('userUpdated'))
        onSuccess()
        fetchAll()
      } else {
        showFeedback(false, data.error || t('failedToUpdate'))
      }
    } catch {
      showFeedback(false, t('networkError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (u: UserRecord, currentUserId: number | undefined): Promise<void> => {
    if (u.id === currentUserId) return
    try {
      const res = await fetch(`/api/auth/users?id=${u.id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        showFeedback(true, t('deletedUser', { username: u.username }))
        fetchAll()
      } else {
        showFeedback(false, data.error || t('failedToDelete'))
      }
    } catch {
      showFeedback(false, t('networkError'))
    }
  }

  const submitReview = async (requestId: number, action: 'approve' | 'reject', reviewForm: ReviewFormState, onSuccess: () => void): Promise<void> => {
    setProcessingRequestId(requestId)
    try {
      const res = await fetch('/api/auth/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          action,
          role: reviewForm.role,
          note: reviewForm.note || undefined,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('failedToAction', { action }))
      const req = requests.find(r => r.id === requestId)
      showFeedback(true, t('requestActioned', { action, email: req?.email || t('user') }))
      onSuccess()
      await fetchAll()
    } catch (e: unknown) {
      showFeedback(false, getErrorMessage(e) || t('failedToAction', { action }))
    } finally {
      setProcessingRequestId(null)
    }
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending')

  return {
    users,
    requests,
    loading,
    error,
    feedback,
    pendingRequests,
    creating,
    saving,
    processingRequestId,
    fetchAll,
    handleCreate,
    handleEdit,
    handleDelete,
    submitReview,
  }
}
