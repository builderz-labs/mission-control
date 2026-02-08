'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'

interface UserRecord {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  created_at: number
  last_login_at: number | null
}

const roleColors: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400',
  operator: 'bg-blue-500/20 text-blue-400',
  viewer: 'bg-gray-500/20 text-gray-400',
}

export function UserManagementPanel() {
  const { currentUser } = useMissionControl()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', password: '', display_name: '', role: 'operator' })
  const [creating, setCreating] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', role: '', password: '' })
  const [saving, setSaving] = useState(false)

  // Feedback
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/users')
      if (res.status === 403) {
        setError('Admin access required')
        return
      }
      const data = await res.json()
      setUsers(data.users || [])
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  // Create user
  const handleCreate = async () => {
    if (!createForm.username || !createForm.password) return
    setCreating(true)
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Created user "${createForm.username}"`)
        setShowCreate(false)
        setCreateForm({ username: '', password: '', display_name: '', role: 'operator' })
        fetchUsers()
      } else {
        showFeedback(false, data.error || 'Failed to create user')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setCreating(false)
    }
  }

  // Start editing
  const startEdit = (u: UserRecord) => {
    setEditingId(u.id)
    setEditForm({ display_name: u.display_name, role: u.role, password: '' })
  }

  // Save edit
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
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, 'User updated')
        setEditingId(null)
        fetchUsers()
      } else {
        showFeedback(false, data.error || 'Failed to update')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  // Delete user
  const handleDelete = async (u: UserRecord) => {
    if (u.id === currentUser?.id) return
    try {
      const res = await fetch(`/api/auth/users?id=${u.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Deleted user "${u.username}"`)
        fetchUsers()
      } else {
        showFeedback(false, data.error || 'Failed to delete')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const formatDate = (ts: number | null) => {
    if (!ts) return 'Never'
    return new Date(ts * 1000).toLocaleString()
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
    return (
      <div className="p-8 text-center">
        <div className="text-sm text-red-400">{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground">{users.length} registered users</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth"
        >
          {showCreate ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`mb-4 px-3 py-2 rounded-md text-sm ${
          feedback.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
          <h3 className="text-sm font-medium text-foreground">New User</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={createForm.username}
              onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
              placeholder="Username"
              className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
            />
            <input
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Password"
              className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
            />
            <input
              value={createForm.display_name}
              onChange={(e) => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="Display name (optional)"
              className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
            />
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm(f => ({ ...f, role: e.target.value }))}
              className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
            >
              <option value="viewer">Viewer</option>
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!createForm.username || !createForm.password || creating}
              className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-secondary/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">Last Login</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-smooth">
                {editingId === u.id ? (
                  <>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground font-mono">@{u.username}</span>
                        <input
                          value={editForm.display_name}
                          onChange={(e) => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                          className="h-7 px-2 rounded bg-secondary border border-border text-sm text-foreground"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                        disabled={u.id === currentUser?.id}
                        className="h-7 px-1 rounded bg-secondary border border-border text-xs text-foreground disabled:opacity-50"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="New password (leave blank)"
                        className="h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground w-full"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={handleEdit}
                          disabled={saving}
                          className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                        >
                          {saving ? '...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="h-7 px-2 rounded-md bg-secondary text-foreground text-xs hover:bg-secondary/80"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-medium text-primary">
                            {u.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">{u.display_name}</div>
                          <div className="text-xs text-muted-foreground">@{u.username}</div>
                        </div>
                        {u.id === currentUser?.id && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">You</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[u.role] || ''}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{formatDate(u.last_login_at)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => startEdit(u)}
                          className="h-7 px-2 rounded-md bg-secondary text-foreground text-xs hover:bg-secondary/80"
                        >
                          Edit
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDelete(u)}
                            className="h-7 px-2 rounded-md bg-destructive/20 text-destructive text-xs hover:bg-destructive/30"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role legend */}
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span><span className="font-medium text-red-400">Admin</span> — Full access, user management</span>
        <span><span className="font-medium text-blue-400">Operator</span> — Agent control, task management</span>
        <span><span className="font-medium text-gray-400">Viewer</span> — Read-only dashboard access</span>
      </div>
    </div>
  )
}
