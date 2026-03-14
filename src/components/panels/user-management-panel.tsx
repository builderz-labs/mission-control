'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

interface UserRecord {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  last_login_at: number | null
}

interface AccessRequest {
  id: number
  provider: string
  email: string
  provider_user_id?: string | null
  display_name?: string | null
  avatar_url?: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: number
  last_attempt_at: number
  attempt_count: number
  reviewed_by?: string | null
  reviewed_at?: number | null
  review_note?: string | null
  approved_user_id?: number | null
}

const roleColors: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400',
  operator: 'bg-blue-500/20 text-blue-400',
  viewer: 'bg-gray-500/20 text-gray-400',
}

export function UserManagementPanel() {
  const t = useTranslations('userManagement')
  const { currentUser } = useMissionControl()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', password: '', display_name: '', role: 'operator' as const })
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', role: '' as '' | 'admin' | 'operator' | 'viewer', password: '' })
  const [saving, setSaving] = useState(false)

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(null)
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null)
  const [reviewForm, setReviewForm] = useState<{ role: 'admin' | 'operator' | 'viewer'; note: string }>({ role: 'viewer', note: '' })

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3200)
  }

  const fetchAll = useCallback(async () => {
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
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const pendingRequests = requests.filter((r) => r.status === 'pending')

  const formatDate = (ts: number | null | undefined) => {
    if (!ts) return t('never')
    return new Date(ts * 1000).toLocaleString()
  }

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password) return
    setCreating(true)
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        showFeedback(true, t('createdUser', { username: createForm.username }))
        setShowCreate(false)
        setCreateForm({ username: '', password: '', display_name: '', role: 'operator' })
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

  const startEdit = (u: UserRecord) => {
    setEditingId(u.id)
    setEditForm({ display_name: u.display_name, role: u.role, password: '' })
  }

  const handleEdit = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      const body: any = { id: editingId }
      if (editForm.display_name) body.display_name = editForm.display_name
      if (editForm.role) body.role = editForm.role
      if (editForm.password) body.password = editForm.password

      const res = await fetch('/api/auth/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        showFeedback(true, t('userUpdated'))
        setEditingId(null)
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

  const handleDelete = async (u: UserRecord) => {
    if (u.id === currentUser?.id) return
    try {
      const res = await fetch(`/api/auth/users?id=${u.id}`, { method: 'DELETE' })
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

  const submitReview = async (requestId: number, action: 'approve' | 'reject') => {
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
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('failedToAction', { action }))
      const req = requests.find(r => r.id === requestId)
      showFeedback(true, t('requestActioned', { action, email: req?.email || t('user') }))
      setReviewingRequestId(null)
      setReviewForm({ role: 'viewer', note: '' })
      await fetchAll()
    } catch (e: any) {
      showFeedback(false, e?.message || t('failedToAction', { action }))
    } finally {
      setProcessingRequestId(null)
    }
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">{t('accessDenied')}</div>
        <p className="text-sm text-muted-foreground">{t('adminRequired')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mx-auto mb-2" />
        <span className="text-sm text-muted-foreground">{t('loadingUsers')}</span>
      </div>
    )
  }

  if (error) {
    return <div className="p-8 text-center"><div className="text-sm text-red-400">{error}</div></div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('usersTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('usersSummary', { count: users.length, pending: pendingRequests.length })}</p>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          size="sm"
        >
          {showCreate ? t('cancel') : t('addLocalUser')}
        </Button>
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${feedback.ok ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {feedback.text}
        </div>
      )}

      {pendingRequests.length > 0 && (
        <div className="border border-amber-500/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-sm font-medium text-amber-200">
              {t('pendingRequests', { count: pendingRequests.length })}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 border-b border-border">
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('identity')}</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('attempts')}</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('lastAttempt')}</th>
                  <th className="text-right px-3 py-2 text-xs text-muted-foreground">{t('action')}</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => (
                  <tr key={req.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        {req.avatar_url ? (
                          <Image
                            src={req.avatar_url}
                            alt=""
                            width={32}
                            height={32}
                            unoptimized
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-full shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
                            {(req.display_name || req.email)?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-foreground">{req.display_name || req.email}</div>
                          <div className="text-xs text-muted-foreground">{req.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{req.attempt_count}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(req.last_attempt_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {reviewingRequestId === req.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <select
                            value={reviewForm.role}
                            onChange={(e) => setReviewForm(f => ({ ...f, role: e.target.value as any }))}
                            className="h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground"
                          >
                            <option value="viewer">{t('roleViewer')}</option>
                            <option value="operator">{t('roleOperator')}</option>
                            <option value="admin">{t('roleAdmin')}</option>
                          </select>
                          <input
                            value={reviewForm.note}
                            onChange={(e) => setReviewForm(f => ({ ...f, note: e.target.value }))}
                            placeholder={t('noteOptional')}
                            className="h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground w-32"
                          />
                          <Button
                            onClick={() => submitReview(req.id, 'approve')}
                            disabled={processingRequestId === req.id}
                            variant="success"
                            size="xs"
                          >
                            {processingRequestId === req.id ? '...' : t('confirm')}
                          </Button>
                          <Button
                            onClick={() => submitReview(req.id, 'reject')}
                            disabled={processingRequestId === req.id}
                            variant="destructive"
                            size="xs"
                          >
                            {t('reject')}
                          </Button>
                          <Button
                            onClick={() => { setReviewingRequestId(null); setReviewForm({ role: 'viewer', note: '' }) }}
                            variant="ghost"
                            size="xs"
                          >
                            {t('cancel')}
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-2">
                          <Button
                            onClick={() => { setReviewingRequestId(req.id); setReviewForm({ role: 'viewer', note: '' }) }}
                            disabled={processingRequestId === req.id}
                            variant="success"
                            size="xs"
                          >
                            {t('review')}
                          </Button>
                          <Button
                            onClick={() => submitReview(req.id, 'reject')}
                            disabled={processingRequestId === req.id}
                            variant="destructive"
                            size="xs"
                          >
                            {t('reject')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h3 className="text-sm font-medium text-foreground">{t('newLocalUser')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))} placeholder={t('username')} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} placeholder={t('password')} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <input value={createForm.display_name} onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))} placeholder={t('displayName')} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as any }))} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground">
              <option value="viewer">{t('roleViewer')}</option>
              <option value="operator">{t('roleOperator')}</option>
              <option value="admin">{t('roleAdmin')}</option>
            </select>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={!createForm.username || !createForm.password || creating} size="sm">
              {creating ? t('creating') : t('createUser')}
            </Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-secondary/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colUser')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colProvider')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colRole')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">{t('colLastLogin')}</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-smooth">
                {editingId === u.id ? (
                  <>
                    <td className="px-4 py-2.5">
                      <input value={editForm.display_name} onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))} className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground w-full" />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.provider || 'local'}</td>
                    <td className="px-4 py-2.5">
                      <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as any }))} className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground" disabled={u.id === currentUser?.id}>
                        <option value="viewer">{t('roleViewer')}</option>
                        <option value="operator">{t('roleOperator')}</option>
                        <option value="admin">{t('roleAdmin')}</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input type="password" value={editForm.password} onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} placeholder={t('newPasswordOptional')} className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground w-full" disabled={(u.provider || 'local') !== 'local'} />
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      <Button onClick={handleEdit} disabled={saving} size="xs">{t('save')}</Button>
                      <Button onClick={() => setEditingId(null)} variant="outline" size="xs">{t('cancel')}</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary overflow-hidden">
                          {u.avatar_url ? (
                            <Image
                              src={u.avatar_url}
                              alt={u.display_name}
                              width={28}
                              height={28}
                              unoptimized
                              className="w-7 h-7 object-cover"
                            />
                          ) : u.display_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">{u.display_name}</div>
                          <div className="text-xs text-muted-foreground">{u.email || u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${u.provider === 'google' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-500/20 text-gray-300'}`}>{u.provider || 'local'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[u.role] || ''}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{formatDate(u.last_login_at)}</td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      <Button onClick={() => startEdit(u)} variant="outline" size="xs">{t('edit')}</Button>
                      {u.id !== currentUser?.id && (
                        <Button onClick={() => handleDelete(u)} variant="destructive" size="xs">{t('delete')}</Button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
