'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Project {
  id: number
  workspace_id: number
  name: string
  slug: string
  description: string | null
  ticket_prefix: string
  ticket_counter: number
  status: 'active' | 'archived'
  created_at: number
  updated_at: number
}

interface Draft {
  name: string
  description: string
  ticket_prefix: string
}

function toDraft(project: Project): Draft {
  return {
    name: project.name,
    description: project.description || '',
    ticket_prefix: project.ticket_prefix,
  }
}

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    ticket_prefix: '',
    description: '',
  })

  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const activeCount = useMemo(() => projects.filter((p) => p.status === 'active').length, [projects])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/projects?includeArchived=1')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load projects')
      setProjects(data.projects || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    try {
      setSaving(true)
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          ticket_prefix: form.ticket_prefix,
          description: form.description,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create project')
      setForm({ name: '', ticket_prefix: '', description: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  const beginEdit = (project: Project) => {
    setEditingId(project.id)
    setDraft(toDraft(project))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
  }

  const saveEdit = async (projectId: number) => {
    if (!draft) return
    try {
      setSaving(true)
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          ticket_prefix: draft.ticket_prefix,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update project')
      cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (project: Project) => {
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: project.status === 'active' ? 'archived' : 'active' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update project status')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project status')
    }
  }

  const deleteProject = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? Existing tasks will be moved to General.`)) return
    try {
      const response = await fetch(`/api/projects/${project.id}?mode=delete`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to delete project')
      if (editingId === project.id) cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Projects</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage projects and ticket prefixes used for task references.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {activeCount} active / {projects.length} total
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{error}</div>
      )}

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Create Project</h3>
        <form onSubmit={createProject} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Project name"
            className="md:col-span-2 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
            required
          />
          <input
            type="text"
            value={form.ticket_prefix}
            onChange={(e) => setForm((prev) => ({ ...prev, ticket_prefix: e.target.value }))}
            placeholder="Ticket prefix (e.g. API)"
            className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Add Project'}
          </button>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Description (optional)"
            className="md:col-span-4 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
          />
        </form>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Existing Projects</h3>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-muted-foreground">No projects found.</div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => {
              const isGeneral = project.slug === 'general'
              const isEditing = editingId === project.id && draft !== null

              return (
                <div key={project.id} className="border border-border rounded-md p-3">
                  {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                        className="md:col-span-2 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={draft.ticket_prefix}
                        onChange={(e) => setDraft((prev) => (prev ? { ...prev, ticket_prefix: e.target.value } : prev))}
                        className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(project.id)}
                          disabled={saving}
                          className="flex-1 bg-primary text-primary-foreground rounded-md px-3 py-2 text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex-1 bg-secondary text-muted-foreground rounded-md px-3 py-2 text-xs font-medium hover:bg-surface-2"
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(e) => setDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                        className="md:col-span-4 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm"
                        placeholder="Description"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{project.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {project.ticket_prefix} · {project.slug} · {project.status} · {project.ticket_counter} tickets
                        </div>
                        {project.description && (
                          <div className="text-xs text-muted-foreground mt-1">{project.description}</div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => beginEdit(project)}
                          className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-secondary"
                        >
                          Edit
                        </button>

                        {!isGeneral && (
                          <>
                            <button
                              onClick={() => toggleStatus(project)}
                              className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-secondary"
                            >
                              {project.status === 'active' ? 'Archive' : 'Activate'}
                            </button>
                            <button
                              onClick={() => deleteProject(project)}
                              className="px-3 py-1.5 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
