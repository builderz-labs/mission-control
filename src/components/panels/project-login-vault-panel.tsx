'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMissionControl } from '@/store'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

type LoginMethod = 'password' | 'google' | 'apple' | 'sso' | 'passkey'

const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  password: 'Password',
  google: 'Sign in with Google',
  apple: 'Sign in with Apple',
  sso: 'SSO',
  passkey: 'Passkey',
}

interface LoginEntry {
  login_id: string
  project_id: number
  service: string
  login_url: string | null
  username: string
  login_method: LoginMethod
  notes: string | null
  has_password: boolean
  created_at: number
  updated_at: number
  last_revealed_at: number | null
}

interface LoginForm {
  service: string
  login_url: string
  username: string
  password: string
  login_method: LoginMethod
  notes: string
}

const emptyForm: LoginForm = { service: '', login_url: '', username: '', password: '', login_method: 'password', notes: '' }

export function ProjectLoginVaultPanel() {
  const { currentUser, activeProject, projects, fetchProjects } = useMissionControl()
  const [projectId, setProjectId] = useState(String(activeProject?.id ?? ''))
  const [entries, setEntries] = useState<LoginEntry[]>([])
  const [form, setForm] = useState<LoginForm>(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revealTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (projects.length === 0) void fetchProjects()
  }, [projects.length, fetchProjects])

  useEffect(() => {
    setProjectId((current) => {
      if (activeProject?.id && projects.some((project) => project.id === activeProject.id)) {
        return String(activeProject.id)
      }
      if (current && projects.some((project) => String(project.id) === current)) return current
      return String(projects[0]?.id ?? '')
    })
  }, [activeProject?.id, projects])

  const clearRevealed = useCallback(() => {
    revealTimers.current.forEach((timer) => clearTimeout(timer))
    revealTimers.current.clear()
    setRevealed({})
  }, [])

  useEffect(() => () => {
    revealTimers.current.forEach((timer) => clearTimeout(timer))
  }, [])

  const loadEntries = useCallback(async (selectedProjectId: string) => {
    if (!selectedProjectId) {
      setEntries([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ logins: LoginEntry[] }>(
        '/api/project-logins?project_id=' + encodeURIComponent(selectedProjectId),
        { cache: 'no-store' },
      )
      setEntries(data.logins || [])
    } catch {
      setEntries([])
      setError('Unable to load login details.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    clearRevealed()
    setEditing(null)
    setForm(emptyForm)
    void loadEntries(projectId)
  }, [projectId, loadEntries, clearRevealed])

  if (currentUser?.role !== 'admin') {
    return <div className="p-6 text-sm text-muted-foreground">Administrator access is required.</div>
  }

  const startEdit = (entry: LoginEntry) => {
    clearRevealed()
    setEditing(entry.login_id)
    setForm({
      service: entry.service,
      login_url: entry.login_url || '',
      username: entry.username,
      password: '',
      login_method: entry.login_method || 'password',
      notes: entry.notes || '',
    })
    setNotice('')
    setError('')
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectId || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (editing) {
        const payload = {
          login_id: editing,
          service: form.service,
          login_url: form.login_url || null,
          username: form.username,
          login_method: form.login_method,
          notes: form.notes || null,
          ...(form.password ? { password: form.password } : {}),
        }
        await apiFetch('/api/project-logins', { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/project-logins', {
          method: 'POST',
          body: JSON.stringify({
            project_id: Number(projectId),
            service: form.service,
            login_url: form.login_url || null,
            username: form.username,
            login_method: form.login_method,
            ...(form.password ? { password: form.password } : {}),
            notes: form.notes || null,
          }),
        })
      }
      clearRevealed()
      setEditing(null)
      setForm(emptyForm)
      setNotice(editing ? 'Login updated.' : 'Login saved.')
      await loadEntries(projectId)
    } catch {
      setError('Unable to save login details. Check the URL and required fields.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: LoginEntry) => {
    if (!window.confirm('Delete saved login for ' + entry.service + '?')) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await apiFetch('/api/project-logins?login_id=' + encodeURIComponent(entry.login_id), { method: 'DELETE' })
      clearRevealed()
      if (editing === entry.login_id) {
        setEditing(null)
        setForm(emptyForm)
      }
      setNotice('Login deleted.')
      await loadEntries(projectId)
    } catch {
      setError('Unable to delete this login.')
    } finally {
      setBusy(false)
    }
  }

  const reveal = async (entry: LoginEntry): Promise<string> => {
    if (revealed[entry.login_id]) return revealed[entry.login_id]
    const data = await apiFetch<{ password: string }>('/api/project-logins/' + entry.login_id + '/reveal', {
      method: 'POST',
      cache: 'no-store',
    })
    const previousTimer = revealTimers.current.get(entry.login_id)
    if (previousTimer) clearTimeout(previousTimer)
    setRevealed((current) => ({ ...current, [entry.login_id]: data.password }))
    revealTimers.current.set(entry.login_id, setTimeout(() => {
      revealTimers.current.delete(entry.login_id)
      setRevealed((current) => {
        const next = { ...current }
        delete next[entry.login_id]
        return next
      })
    }, 60_000))
    return data.password
  }

  const hide = (loginId: string) => {
    const timer = revealTimers.current.get(loginId)
    if (timer) clearTimeout(timer)
    revealTimers.current.delete(loginId)
    setRevealed((current) => {
      const next = { ...current }
      delete next[loginId]
      return next
    })
  }

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(label + ' copied.')
      setError('')
    } catch {
      setError('Unable to copy ' + label.toLowerCase() + '.')
    }
  }

  const copyPassword = async (entry: LoginEntry) => {
    setError('')
    try {
      await copy(await reveal(entry), 'Password')
    } catch {
      setError('Unable to reveal or copy this password.')
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold">Project Login Vault</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a project, then save the exact account ID and password used for each service.
        </p>
      </header>

      <label className="block max-w-xl text-sm font-medium">
        Project
        <select
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {projects.length === 0 && <option value="">No projects available</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
        Passwords are encrypted with Windows DPAPI. Do not put backup codes or TOTP seeds in Notes; Notes are metadata and are not encrypted.
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <h2 className="font-medium">No project selected</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create or select a project before saving login details.</p>
        </div>
      ) : (
        <>
          <form onSubmit={save} className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2">
            <h2 className="text-lg font-medium md:col-span-2">{editing ? 'Edit login' : 'Add a login'}</h2>

            <label className="text-sm">
              Service or site
              <input
                required
                maxLength={120}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.service}
                onChange={(event) => setForm({ ...form, service: event.target.value })}
                placeholder="Instagram, TikTok, LinkedIn..."
              />
            </label>

            <label className="text-sm">
              Login URL
              <input
                type="url"
                maxLength={2048}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.login_url}
                onChange={(event) => setForm({ ...form, login_url: event.target.value })}
                placeholder="https://example.com/login"
              />
            </label>

            <label className="text-sm">
              ID or email
              <input
                required
                maxLength={320}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </label>

            <label className="text-sm">
              Login method
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.login_method}
                onChange={(event) => setForm({ ...form, login_method: event.target.value as LoginMethod, password: event.target.value === 'password' ? form.password : '' })}
              >
                {Object.entries(LOGIN_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>

            {form.login_method === 'password' && (
            <label className="text-sm">
              Password
              {editing && <span className="ml-1 text-muted-foreground">(leave blank to keep current)</span>}
              <input
                required={!editing}
                type="password"
                maxLength={32768}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            )}

            <label className="text-sm md:col-span-2">
              Notes
              <textarea
                maxLength={2000}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Which team/account this is for, recovery email hint, etc."
              />
            </label>

            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save login'}</Button>
              {editing && (
                <Button type="button" variant="outline" onClick={() => {
                  clearRevealed()
                  setEditing(null)
                  setForm(emptyForm)
                }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}

          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <h2 className="font-medium">{loading ? 'Loading project logins…' : 'No logins saved for this project'}</h2>
              {!loading && <p className="mt-1 text-sm text-muted-foreground">Add the first account above. Passwords stay hidden until you explicitly reveal or copy one.</p>}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {entries.map((entry) => (
                <article key={entry.login_id} className="space-y-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold">{entry.service}</h3>
                      <p className="truncate text-sm text-muted-foreground">{entry.username}</p>
                    </div>
                    <span className="rounded bg-secondary px-2 py-1 text-xs">{LOGIN_METHOD_LABELS[entry.login_method || 'password']}</span>
                  </div>

                  {entry.login_url && (
                    <a href={entry.login_url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-primary underline">
                      Open login page
                    </a>
                  )}

                  {entry.login_method === 'password' && (
                    <div className="rounded-md bg-secondary/50 p-2 font-mono text-sm break-all">
                      {revealed[entry.login_id] || '••••••••••••'}
                    </div>
                  )}

                  {entry.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.notes}</p>}
                  <p className="text-xs text-muted-foreground">Updated {new Date(entry.updated_at * 1000).toLocaleString()}</p>

                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" variant="outline" onClick={() => void copy(entry.username, 'ID')}>Copy ID</Button>
                    {entry.login_method === 'password' && <>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => revealed[entry.login_id] ? hide(entry.login_id) : void reveal(entry).catch(() => setError('Unable to reveal this password.'))}
                      >
                        {revealed[entry.login_id] ? 'Hide' : 'Reveal'}
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => void copyPassword(entry)}>Copy Password</Button>
                    </>}
                    <Button size="xs" variant="outline" onClick={() => startEdit(entry)}>Edit</Button>
                    <Button size="xs" variant="destructive" disabled={busy} onClick={() => void remove(entry)}>Delete</Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
