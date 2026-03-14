'use client'

import { useState, useCallback, useEffect } from 'react'
import { useFocusTrap } from '@/lib/use-focus-trap'
import type { Project } from './types'

export interface ProjectManagerModalProps {
  onClose: () => void
  onChanged: () => Promise<void>
}

export function ProjectManagerModal({
  onClose,
  onChanged
}: ProjectManagerModalProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', ticket_prefix: '', description: '' })

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
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          ticket_prefix: form.ticket_prefix,
          description: form.description
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create project')
      setForm({ name: '', ticket_prefix: '', description: '' })
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  const archiveProject = async (project: Project) => {
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: project.status === 'active' ? 'archived' : 'active' })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update project')
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project')
    }
  }

  const deleteProject = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? Existing tasks will be moved to General.`)) return
    try {
      const response = await fetch(`/api/projects/${project.id}?mode=delete`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to delete project')
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="projects-title" className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 id="projects-title" className="text-xl font-bold text-foreground">Project Management</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl">×</button>
          </div>

          {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">{error}</div>}

          <form onSubmit={createProject} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Project name"
              className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
              required
            />
            <input
              type="text"
              value={form.ticket_prefix}
              onChange={(e) => setForm((prev) => ({ ...prev, ticket_prefix: e.target.value }))}
              placeholder="Ticket prefix (e.g. PA)"
              className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
            />
            <button type="submit" className="bg-primary text-primary-foreground rounded-md px-3 py-2 hover:bg-primary/90">
              Add Project
            </button>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Description (optional)"
              className="md:col-span-3 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
            />
          </form>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div key={project.id} className="flex items-center justify-between border border-border rounded-md p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{project.name}</div>
                    <div className="text-xs text-muted-foreground">{project.ticket_prefix} · {project.slug} · {project.status}</div>
                  </div>
                  <div className="flex gap-2">
                    {project.slug !== 'general' && (
                      <>
                        <button
                          onClick={() => archiveProject(project)}
                          className="px-3 py-1 text-xs rounded border border-border hover:bg-secondary"
                        >
                          {project.status === 'active' ? 'Archive' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteProject(project)}
                          className="px-3 py-1 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
