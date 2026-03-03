'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const [reviewDialog, setReviewDialog] = useState<{ req: AccessRequest; action: 'approve' | 'reject' } | null>(null)
  const [reviewRole, setReviewRole] = useState<'viewer' | 'operator' | 'admin'>('viewer')
  const [reviewNote, setReviewNote] = useState('')
  const [selectedRequests, setSelectedRequests] = useState<Set<number>>(new Set())
  const [showRequestHistory, setShowRequestHistory] = useState(false)

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
        setError('Admin access required')
        return
      }

      const uJson = await uRes.json().catch(() => ({}))
      const rJson = await rRes.json().catch(() => ({}))

      setUsers(Array.isArray(uJson?.users) ? uJson.users : [])
      setRequests(Array.isArray(rJson?.requests) ? rJson.requests : [])
      setError(null)
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const pendingRequests = requests.filter((r) => r.status === 'pending')

  const formatDate = (ts: number | null | undefined) => {
    if (!ts) return 'Never'
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
        showFeedback(true, `Created user "${createForm.username}"`)
        setShowCreate(false)
        setCreateForm({ username: '', password: '', display_name: '', role: 'operator' })
        fetchAll()
      } else {
        showFeedback(false, data.error || 'Failed to create user')
      }
    } catch {
      showFeedback(false, 'Network error')
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
        showFeedback(true, 'User updated')
        setEditingId(null)
        fetchAll()
      } else {
        showFeedback(false, data.error || 'Failed to update')
      }
    } catch {
      showFeedback(false, 'Network error')
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
        showFeedback(true, `Deleted user "${u.username}"`)
        fetchAll()
      } else {
        showFeedback(false, data.error || 'Failed to delete')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const openReviewDialog = (req: AccessRequest, action: 'approve' | 'reject') => {
    setReviewDialog({ req, action })
    setReviewRole('viewer')
    setReviewNote('')
  }

  const submitReview = async () => {
    if (!reviewDialog) return
    const { req, action } = reviewDialog
    setProcessingRequestId(req.id)
    setReviewDialog(null)
    try {
      const res = await fetch('/api/auth/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: req.id, action, role: reviewRole, note: reviewNote || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed to ${action} request`)
      showFeedback(true, `Request ${action}d for ${req.email}`)
      setSelectedRequests((s) => { const n = new Set(s); n.delete(req.id); return n })
      await fetchAll()
    } catch (e: any) {
      showFeedback(false, e?.message || `Failed to ${action} request`)
    } finally {
      setProcessingRequestId(null)
    }
  }

  const batchReview = async (action: 'approve' | 'reject') => {
    for (const id of selectedRequests) {
      const req = pendingRequests.find((r) => r.id === id)
      if (!req) continue
      setProcessingRequestId(id)
      try {
        const res = await fetch('/api/auth/access-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: id, action, role: 'viewer' }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          showFeedback(false, data.error || `Failed to ${action} request for ${req.email}`)
        }
      } catch { /* continue */ }
    }
    setSelectedRequests(new Set())
    showFeedback(true, `Batch ${action} complete (${selectedRequests.size} request${selectedRequests.size !== 1 ? 's' : ''})`)
    setProcessingRequestId(null)
    fetchAll()
  }

  const toggleSelectRequest = (id: number) => {
    setSelectedRequests((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedRequests.size === pendingRequests.length) {
      setSelectedRequests(new Set())
    } else {
      setSelectedRequests(new Set(pendingRequests.map((r) => r.id)))
    }
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">Access Denied</div>
        <p className="text-sm text-muted-foreground">User management requires admin privileges.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mx-auto mb-2" />
        <span className="text-sm text-muted-foreground">Loading users...</span>
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
          <h2 className="text-lg font-semibold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground">{users.length} registered users · {pendingRequests.length} pending approvals</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth"
        >
          {showCreate ? 'Cancel' : '+ Add Local User'}
        </button>
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${feedback.ok ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {feedback.text}
        </div>
      )}

      {/* Review dialog overlay */}
      {reviewDialog && (
        <div className="rounded-lg border border-border bg-secondary/80 backdrop-blur p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {reviewDialog.action === 'approve' ? 'Approve' : 'Reject'} access for {reviewDialog.req.display_name || reviewDialog.req.email}
          </h3>
          <p className="text-xs text-muted-foreground">{reviewDialog.req.email}</p>

          {reviewDialog.action === 'approve' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Assign role</label>
              <div className="flex gap-1.5">
                {(['viewer', 'operator', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setReviewRole(r)}
                    className={`h-7 px-3 rounded text-xs font-medium transition-smooth ${
                      reviewRole === r
                        ? r === 'admin' ? 'bg-red-500/20 text-red-400' : r === 'operator' ? 'bg-blue-500/20 text-blue-400' : 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Note (optional)</label>
            <input
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={reviewDialog.action === 'approve' ? 'Welcome aboard!' : 'Reason for rejection'}
              className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setReviewDialog(null)}
              className="flex-1 h-8 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground border border-border transition-smooth"
            >
              Cancel
            </button>
            <button
              onClick={submitReview}
              className={`flex-1 h-8 rounded-md text-xs font-medium transition-smooth ${
                reviewDialog.action === 'approve'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                  : 'bg-red-600 text-white hover:bg-red-600/90'
              }`}
            >
              {reviewDialog.action === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <div className="border border-amber-500/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
            <span className="text-sm font-medium text-amber-200">Pending Access Requests ({pendingRequests.length})</span>
            {selectedRequests.size > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => batchReview('approve')}
                  className="h-6 px-2 rounded text-2xs font-medium bg-emerald-600 text-white hover:bg-emerald-600/90 transition-smooth"
                >
                  Approve {selectedRequests.size} selected
                </button>
                <button
                  onClick={() => batchReview('reject')}
                  className="h-6 px-2 rounded text-2xs font-medium bg-red-600 text-white hover:bg-red-600/90 transition-smooth"
                >
                  Reject {selectedRequests.size}
                </button>
              </div>
            )}
          </div>
          <div className="divide-y divide-border/40">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-smooth">
                <input
                  type="checkbox"
                  checked={selectedRequests.has(req.id)}
                  onChange={() => toggleSelectRequest(req.id)}
                  className="rounded border-border"
                />
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-semibold text-blue-400 overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {req.avatar_url ? <img src={req.avatar_url} alt={req.display_name || ''} className="w-8 h-8 object-cover" /> : (req.display_name || req.email).split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{req.display_name || req.email}</div>
                  <div className="text-xs text-muted-foreground">{req.email} · {req.attempt_count} attempt{req.attempt_count !== 1 ? 's' : ''} · Last: {formatDate(req.last_attempt_at)}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openReviewDialog(req, 'approve')}
                    disabled={processingRequestId === req.id}
                    className="h-7 px-2.5 rounded border border-emerald-500/30 text-emerald-400 text-xs font-medium disabled:opacity-50 hover:bg-emerald-500/10 transition-smooth"
                  >
                    {processingRequestId === req.id ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => openReviewDialog(req, 'reject')}
                    disabled={processingRequestId === req.id}
                    className="h-7 px-2.5 rounded border border-red-500/30 text-red-400 text-xs font-medium disabled:opacity-50 hover:bg-red-500/10 transition-smooth"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
          {pendingRequests.length > 1 && (
            <div className="px-4 py-2 bg-secondary/30 border-t border-border/40">
              <button
                onClick={toggleSelectAll}
                className="text-2xs text-muted-foreground hover:text-foreground transition-smooth"
              >
                {selectedRequests.size === pendingRequests.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Request history */}
      {requests.filter((r) => r.status !== 'pending').length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowRequestHistory(!showRequestHistory)}
            className="w-full px-4 py-2.5 bg-secondary/30 text-left flex items-center justify-between hover:bg-secondary/50 transition-smooth"
          >
            <span className="text-xs font-medium text-muted-foreground">
              Request History ({requests.filter((r) => r.status !== 'pending').length})
            </span>
            <span className="text-xs text-muted-foreground/50">{showRequestHistory ? '▲' : '▼'}</span>
          </button>
          {showRequestHistory && (
            <div className="divide-y divide-border/40">
              {requests.filter((r) => r.status !== 'pending').map((req) => (
                <div key={req.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    req.status === 'approved' ? 'bg-emerald-500' : 'bg-red-500'
                  }`} />
                  <span className="text-foreground font-medium">{req.display_name || req.email}</span>
                  <span className="text-muted-foreground">{req.email}</span>
                  <span className={`px-1.5 py-0.5 rounded text-2xs font-medium ${
                    req.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {req.status}
                  </span>
                  {req.reviewed_by && <span className="text-muted-foreground/60">by {req.reviewed_by}</span>}
                  {req.review_note && <span className="text-muted-foreground/60 italic truncate max-w-[200px]">&ldquo;{req.review_note}&rdquo;</span>}
                  <span className="text-muted-foreground/50 ml-auto">{formatDate(req.reviewed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h3 className="text-sm font-medium text-foreground">New Local User</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))} placeholder="Username" className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} placeholder="Password" className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <input value={createForm.display_name} onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Display name" className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground" />
            <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as any }))} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground">
              <option value="viewer">Viewer</option>
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button onClick={handleCreate} disabled={!createForm.username || !createForm.password || creating} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-secondary/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Provider</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">Last Login</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
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
                        <option value="viewer">Viewer</option>
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input type="password" value={editForm.password} onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} placeholder="New password (optional)" className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground w-full" disabled={(u.provider || 'local') !== 'local'} />
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      <button onClick={handleEdit} disabled={saving} className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs">Save</button>
                      <button onClick={() => setEditingId(null)} className="h-7 px-2 rounded border border-border text-xs">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {u.avatar_url ? <img src={u.avatar_url} alt={u.display_name} className="w-7 h-7 object-cover" /> : u.display_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
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
                      <button onClick={() => startEdit(u)} className="h-7 px-2 rounded border border-border text-xs">Edit</button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u)} className="h-7 px-2 rounded-md bg-destructive/20 text-destructive text-xs hover:bg-destructive/30">Delete</button>
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
