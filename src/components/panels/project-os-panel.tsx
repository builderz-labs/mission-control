'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface Project {
  id: number
  name: string
  slug: string
  description?: string | null
  ticket_prefix: string
  status: string
  github_repo?: string | null
  deadline?: number | null
  color?: string | null
  task_count?: number
  assigned_agents?: string[]
}

interface Task {
  id: number
  title: string
  description?: string | null
  status: 'backlog' | 'inbox' | 'assigned' | 'awaiting_owner' | 'in_progress' | 'review' | 'quality_review' | 'done' | 'failed'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  project_id?: number | null
  project_name?: string | null
  ticket_ref?: string
  assigned_to?: string | null
  due_date?: number | null
  tags?: string[]
  metadata?: Record<string, unknown>
  updated_at?: number
  created_at?: number
}

type Section = 'projects' | 'ideas' | 'snapshots' | 'archive' | 'settings'

type CreateMode = 'task' | 'idea'

const COLUMNS: Array<{ key: Task['status']; label: string; hint: string }> = [
  { key: 'backlog', label: 'Planejado', hint: 'ideia já validada / backlog' },
  { key: 'in_progress', label: 'Fazendo', hint: 'execução ativa' },
  { key: 'review', label: 'Finalizando', hint: 'revisão, aprovação ou ajustes' },
  { key: 'quality_review', label: 'Pronto', hint: 'qualidade / pronto para entregar' },
  { key: 'done', label: 'Concluído', hint: 'fechado' },
]

const statusLabel: Record<string, string> = {
  backlog: 'Planejado',
  inbox: 'Inbox',
  assigned: 'Atribuído',
  awaiting_owner: 'Aguardando Paulo',
  in_progress: 'Fazendo',
  review: 'Finalizando',
  quality_review: 'Pronto',
  done: 'Concluído',
  failed: 'Falhou',
}

const priorityTone: Record<string, string> = {
  low: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10',
  medium: 'border-blue-500/30 text-blue-300 bg-blue-500/10',
  high: 'border-amber-500/30 text-amber-300 bg-amber-500/10',
  critical: 'border-red-500/30 text-red-300 bg-red-500/10',
  urgent: 'border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10',
}

function fmtDate(ts?: number | null) {
  if (!ts) return 'sem prazo'
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function normalizeTasks(tasks: Task[]) {
  return tasks.map(task => ({
    ...task,
    tags: Array.isArray(task.tags) ? task.tags : [],
    metadata: task.metadata && typeof task.metadata === 'object' ? task.metadata : {},
  }))
}

function taskIsIdea(task: Task) {
  return task.tags?.includes('ideia') || task.tags?.includes('idea') || task.metadata?.kind === 'idea'
}

function taskMatchesColumn(task: Task, column: Task['status']) {
  if (column === 'backlog') return task.status === 'backlog' || task.status === 'inbox' || task.status === 'assigned' || task.status === 'awaiting_owner'
  if (column === 'review') return task.status === 'review'
  return task.status === column
}

export function ProjectOSPanel() {
  const [section, setSection] = useState<Section>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createMode, setCreateMode] = useState<CreateMode>('task')
  const [quickForm, setQuickForm] = useState({ title: '', description: '', priority: 'medium' as Task['priority'] })
  const [projectForm, setProjectForm] = useState({ name: '', ticket_prefix: '', description: '' })

  const activeProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects])
  const archivedProjects = useMemo(() => projects.filter(p => p.status === 'archived'), [projects])
  const selectedProject = useMemo(
    () => activeProjects.find(p => p.id === selectedProjectId) || activeProjects[0] || projects[0] || null,
    [activeProjects, projects, selectedProjectId]
  )

  const projectTasks = useMemo(() => {
    if (!selectedProject) return []
    return tasks.filter(task => task.project_id === selectedProject.id)
  }, [tasks, selectedProject])

  const ideas = useMemo(() => tasks.filter(taskIsIdea), [tasks])
  const openTasks = useMemo(() => projectTasks.filter(t => t.status !== 'done' && t.status !== 'failed'), [projectTasks])
  const blockedTasks = useMemo(() => projectTasks.filter(t => t.status === 'awaiting_owner' || t.status === 'failed'), [projectTasks])
  const completedTasks = useMemo(() => projectTasks.filter(t => t.status === 'done'), [projectTasks])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [projectsRes, tasksRes] = await Promise.all([
        fetch('/api/projects?includeArchived=1', { cache: 'no-store' }),
        fetch('/api/tasks?limit=200', { cache: 'no-store' }),
      ])
      const projectsData = await projectsRes.json().catch(() => ({}))
      const tasksData = await tasksRes.json().catch(() => ({}))
      if (!projectsRes.ok) throw new Error(projectsData.error || 'Falha ao carregar projetos')
      if (!tasksRes.ok) throw new Error(tasksData.error || 'Falha ao carregar tarefas')
      const nextProjects = Array.isArray(projectsData.projects) ? projectsData.projects : []
      setProjects(nextProjects)
      setTasks(normalizeTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks : []))
      setSelectedProjectId(prev => prev || nextProjects.find((p: Project) => p.status !== 'archived')?.id || nextProjects[0]?.id || null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar Project OS')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectForm.name.trim()) return
    try {
      setSaving(true)
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectForm),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Falha ao criar projeto')
      setProjectForm({ name: '', ticket_prefix: '', description: '' })
      await load()
      if (data.project?.id) setSelectedProjectId(data.project.id)
      setSection('projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar projeto')
    } finally {
      setSaving(false)
    }
  }

  const createItem = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!quickForm.title.trim() || !selectedProject) return
    const isIdea = createMode === 'idea'
    try {
      setSaving(true)
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quickForm.title.trim(),
          description: quickForm.description.trim() || null,
          priority: quickForm.priority,
          status: isIdea ? 'inbox' : 'backlog',
          project_id: selectedProject.id,
          tags: isIdea ? ['ideia'] : ['project-os'],
          metadata: { source: 'project-os', kind: isIdea ? 'idea' : 'task' },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Falha ao criar item')
      setQuickForm({ title: '', description: '', priority: 'medium' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar item')
    } finally {
      setSaving(false)
    }
  }

  const moveTask = async (task: Task, status: Task['status']) => {
    try {
      setSaving(true)
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [{ id: task.id, status }] }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Falha ao mover card')
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao mover card')
    } finally {
      setSaving(false)
    }
  }

  const sidebarItems: Array<{ key: Section; label: string; count?: number }> = [
    { key: 'projects', label: 'Projetos', count: activeProjects.length },
    { key: 'ideas', label: 'Ideias', count: ideas.length },
    { key: 'snapshots', label: 'Snapshots' },
    { key: 'archive', label: 'Arquivo', count: archivedProjects.length },
    { key: 'settings', label: 'Ajustes' },
  ]

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando Project OS...</div>
  }

  return (
    <div className="min-h-full bg-[#05070a] text-foreground">
      <div className="border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 via-background to-fuchsia-950/20 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-cyan-300/70">Cítara Mission Control</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">Project OS</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Projetos, clientes, ideias, snapshots e execução em um lugar só — sem virar outro app solto.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:flex">
            <Stat label="Projetos" value={activeProjects.length} />
            <Stat label="Abertos" value={tasks.filter(t => t.status !== 'done' && t.status !== 'failed').length} />
            <Stat label="Ideias" value={ideas.length} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-[calc(100vh-150px)] grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-border/70 bg-black/25 p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-1">
            {sidebarItems.map(item => (
              <button
                key={item.key}
                onClick={() => setSection(item.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  section === item.key ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-400/30' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <span>{item.label}</span>
                {typeof item.count === 'number' && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{item.count}</span>}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-border/70 bg-card/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projeto ativo</p>
            <div className="mt-3 space-y-2">
              {activeProjects.slice(0, 12).map(project => (
                <button
                  key={project.id}
                  onClick={() => { setSelectedProjectId(project.id); setSection('projects') }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    selectedProject?.id === project.id ? 'border-fuchsia-400/40 bg-fuchsia-500/10' : 'border-border bg-background/60 hover:border-cyan-400/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color || '#22d3ee' }} />
                    <span className="truncate text-sm font-medium">{project.name}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{project.ticket_prefix} · {project.task_count || 0} cards</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 p-4 lg:p-5">
          {section === 'projects' && selectedProject && (
            <ProjectsSection
              project={selectedProject}
              tasks={projectTasks}
              openTasks={openTasks}
              blockedTasks={blockedTasks}
              completedTasks={completedTasks}
              createMode={createMode}
              setCreateMode={setCreateMode}
              quickForm={quickForm}
              setQuickForm={setQuickForm}
              createItem={createItem}
              moveTask={moveTask}
              saving={saving}
            />
          )}

          {section === 'ideas' && (
            <IdeasSection ideas={ideas} projects={projects} moveTask={moveTask} saving={saving} />
          )}

          {section === 'snapshots' && (
            <SnapshotsSection projects={activeProjects} tasks={tasks} />
          )}

          {section === 'archive' && (
            <ArchiveSection projects={archivedProjects} />
          )}

          {section === 'settings' && (
            <SettingsSection projectForm={projectForm} setProjectForm={setProjectForm} createProject={createProject} saving={saving} />
          )}

          {section === 'projects' && !selectedProject && (
            <EmptyState title="Nenhum projeto ainda" description="Crie o primeiro projeto em Ajustes para começar o Project OS." />
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 min-w-[88px]">
      <div className="text-lg font-black text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function ProjectsSection(props: {
  project: Project
  tasks: Task[]
  openTasks: Task[]
  blockedTasks: Task[]
  completedTasks: Task[]
  createMode: CreateMode
  setCreateMode: (mode: CreateMode) => void
  quickForm: { title: string; description: string; priority: Task['priority'] }
  setQuickForm: (value: { title: string; description: string; priority: Task['priority'] }) => void
  createItem: (event: React.FormEvent) => void
  moveTask: (task: Task, status: Task['status']) => Promise<void>
  saving: boolean
}) {
  const { project, tasks, openTasks, blockedTasks, completedTasks } = props
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-2xl shadow-cyan-950/10">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-200 ring-1 ring-cyan-400/20">{project.ticket_prefix}</span>
              <h2 className="text-2xl font-black text-white">{project.name}</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{project.description || 'Sem descrição — use como hub visual deste cliente/projeto.'}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {project.github_repo && <span className="rounded border border-border px-2 py-1">GitHub: {project.github_repo}</span>}
              <span className="rounded border border-border px-2 py-1">Prazo: {fmtDate(project.deadline)}</span>
              <span className="rounded border border-border px-2 py-1">Agentes: {project.assigned_agents?.length || 0}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Abertos" value={openTasks.length} />
            <Stat label="Bloqueios" value={blockedTasks.length} />
            <Stat label="Done" value={completedTasks.length} />
          </div>
        </div>
      </div>

      <form onSubmit={props.createItem} className="rounded-2xl border border-dashed border-fuchsia-400/30 bg-fuchsia-950/10 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex gap-2 lg:self-center">
            <ModeButton active={props.createMode === 'task'} onClick={() => props.setCreateMode('task')}>Tarefa</ModeButton>
            <ModeButton active={props.createMode === 'idea'} onClick={() => props.setCreateMode('idea')}>Ideia</ModeButton>
          </div>
          <input
            value={props.quickForm.title}
            onChange={e => props.setQuickForm({ ...props.quickForm, title: e.target.value })}
            placeholder={props.createMode === 'idea' ? 'Capturar ideia rápida...' : 'Nova tarefa do projeto...'}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-400/50"
          />
          <select
            value={props.quickForm.priority}
            onChange={e => props.setQuickForm({ ...props.quickForm, priority: e.target.value as Task['priority'] })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="low">baixa</option>
            <option value="medium">média</option>
            <option value="high">alta</option>
            <option value="critical">crítica</option>
            <option value="urgent">urgente</option>
          </select>
          <Button type="submit" disabled={props.saving || !props.quickForm.title.trim()}>Criar</Button>
        </div>
        <textarea
          value={props.quickForm.description}
          onChange={e => props.setQuickForm({ ...props.quickForm, description: e.target.value })}
          placeholder="Contexto curto, link, próximo passo, critério de pronto..."
          rows={2}
          className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-400/50"
        />
      </form>

      <div className="grid gap-3 xl:grid-cols-5">
        {COLUMNS.map(column => {
          const columnTasks = tasks.filter(task => taskMatchesColumn(task, column.key) && !taskIsIdea(task))
          return (
            <div key={column.key} className="rounded-2xl border border-border bg-black/20 p-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-white">{column.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{column.hint}</p>
                </div>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{columnTasks.length}</span>
              </div>
              <div className="space-y-2">
                {columnTasks.map(task => <TaskCard key={task.id} task={task} moveTask={props.moveTask} saving={props.saving} />)}
                {columnTasks.length === 0 && <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">vazio</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskCard({ task, moveTask, saving }: { task: Task; moveTask: (task: Task, status: Task['status']) => Promise<void>; saving: boolean }) {
  return (
    <article className="rounded-xl border border-white/10 bg-card p-3 shadow-sm transition hover:border-cyan-400/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-white">{task.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{task.ticket_ref || `#${task.id}`} · {statusLabel[task.status] || task.status}</p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${priorityTone[task.priority] || priorityTone.medium}`}>{task.priority}</span>
      </div>
      {task.description && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{task.description}</p>}
      {task.assigned_to && <p className="mt-2 text-[11px] text-cyan-200">@{task.assigned_to}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {COLUMNS.map(col => (
          <button
            key={col.key}
            disabled={saving || task.status === col.key}
            onClick={() => moveTask(task, col.key)}
            className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-cyan-400/40 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {col.label}
          </button>
        ))}
      </div>
    </article>
  )
}

function IdeasSection({ ideas, projects, moveTask, saving }: { ideas: Task[]; projects: Project[]; moveTask: (task: Task, status: Task['status']) => Promise<void>; saving: boolean }) {
  return (
    <div className="space-y-4">
      <SectionTitle title="Ideias soltas" subtitle="Tudo que entrou como pensamento bruto antes de virar projeto/tarefa." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ideas.map(idea => (
          <div key={idea.id} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="text-xs text-muted-foreground">{projects.find(p => p.id === idea.project_id)?.name || 'Projeto geral'} · {idea.ticket_ref || `#${idea.id}`}</div>
            <h3 className="mt-2 text-base font-bold text-white">{idea.title}</h3>
            {idea.description && <p className="mt-2 text-sm text-muted-foreground">{idea.description}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" disabled={saving} onClick={() => moveTask(idea, 'backlog')}>Virar backlog</Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => moveTask(idea, 'in_progress')}>Começar</Button>
            </div>
          </div>
        ))}
        {ideas.length === 0 && <EmptyState title="Sem ideias capturadas" description="Use o formulário do projeto ativo e selecione Ideia." />}
      </div>
    </div>
  )
}

function SnapshotsSection({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const snapshots = projects.map(project => {
    const scoped = tasks.filter(task => task.project_id === project.id)
    const open = scoped.filter(task => task.status !== 'done' && task.status !== 'failed')
    const stale = open.filter(task => task.updated_at && Date.now() / 1000 - task.updated_at > 7 * 86400)
    return { project, scoped, open, stale, done: scoped.filter(task => task.status === 'done') }
  })
  return (
    <div className="space-y-4">
      <SectionTitle title="Snapshots" subtitle="Foto executiva de cada projeto: aberto, parado e concluído." />
      <div className="grid gap-3 lg:grid-cols-2">
        {snapshots.map(({ project, scoped, open, stale, done }) => (
          <div key={project.id} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-white">{project.name}</h3>
                <p className="text-xs text-muted-foreground">Snapshot gerado agora pelo Mission Control</p>
              </div>
              <span className="rounded bg-white/10 px-2 py-1 text-xs">{project.ticket_prefix}</span>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <Stat label="Total" value={scoped.length} />
              <Stat label="Aberto" value={open.length} />
              <Stat label="Parado" value={stale.length} />
              <Stat label="Done" value={done.length} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Próxima ação sugerida: {stale.length ? 'destravar cards parados há mais de 7 dias.' : open.length ? 'priorizar o próximo card aberto.' : 'manter arquivado ou criar próxima frente.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ArchiveSection({ projects }: { projects: Project[] }) {
  return (
    <div className="space-y-4">
      <SectionTitle title="Arquivo" subtitle="Projetos arquivados para referência e recuperação futura." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(project => (
          <div key={project.id} className="rounded-2xl border border-border bg-card/60 p-4 opacity-75">
            <h3 className="font-bold text-white">{project.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{project.description || 'Sem descrição'}</p>
          </div>
        ))}
        {projects.length === 0 && <EmptyState title="Arquivo vazio" description="Nenhum projeto arquivado por enquanto." />}
      </div>
    </div>
  )
}

function SettingsSection({ projectForm, setProjectForm, createProject, saving }: {
  projectForm: { name: string; ticket_prefix: string; description: string }
  setProjectForm: (value: { name: string; ticket_prefix: string; description: string }) => void
  createProject: (event: React.FormEvent) => void
  saving: boolean
}) {
  return (
    <div className="max-w-3xl space-y-4">
      <SectionTitle title="Ajustes do Project OS" subtitle="Crie hubs para clientes, produtos internos e frentes estratégicas." />
      <form onSubmit={createProject} className="rounded-2xl border border-border bg-card/70 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_160px]">
          <input value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="Nome do projeto/cliente" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input value={projectForm.ticket_prefix} onChange={e => setProjectForm({ ...projectForm, ticket_prefix: e.target.value })} placeholder="Prefixo: EMASFI" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <textarea value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} rows={4} placeholder="Descrição, objetivo, links e regra de uso..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <Button type="submit" disabled={saving || !projectForm.name.trim()}>Criar projeto</Button>
      </form>
      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-950/10 p-4 text-sm text-cyan-100/80">
        <strong>Regra Cítara:</strong> use projetos para clientes e produtos internos; use ideias para ruído bruto; use snapshots para decidir o próximo movimento.
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-lg border px-3 py-2 text-sm ${active ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100' : 'border-border text-muted-foreground hover:text-foreground'}`}>{children}</button>
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-xl font-black text-white">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
      <h3 className="font-bold text-white">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
