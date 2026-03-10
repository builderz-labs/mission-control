'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { openOrchestratorChat } from '@/lib/open-orchestrator-chat'

interface OrchestratorProject {
  id: number
  name: string
  folder: string
  description?: string
  created_at: number
  updated_at: number
  folder_exists?: boolean
  runnable?: boolean
  issue?: string | null
}

interface OrchestratorRun {
  id: number
  project_id: number | null
  folder: string
  task_description: string
  status: 'running' | 'completed' | 'failed'
  output?: string
  files_json?: string
  files?: string[]
  exit_code?: number
  error?: string
  grade?: number | null
  audit_notes?: string | null
  lesson?: string | null
  task_id?: number | null
  started_at: number
  completed_at?: number
}

interface TeamAgent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_activity?: string
  config?: string
}

interface SuggestedFile {
  path: string
  name: string
  reason: string
  priority: number
  source?: 'project' | 'reference-pack' | 'learned-memory'
}

const AUTH_HEADER = { 'x-mc-auth': 'dev' }

// Orchestrator team member names (matches ai-orchestrator/src/task-router.js)
const TEAM_NAMES = ['TechLead', 'ChatGPT', 'Gemini', 'Kimi', 'AmazonQ', 'Ollama', 'UIDesigner', 'Groq', 'Reviewer', 'Review2', 'Review3', 'Review4']

// ─── Task Templates ───────────────────────────────────────────────────────────
interface TaskTemplate {
  id: string
  label: string
  icon: string
  prompt: string
  hint?: string
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'fix_errors',
    label: 'Fix errors from report',
    icon: '🐛',
    prompt: 'Analyze the attached error report. Identify root causes, fix all issues, and create a summary in output/fix-report.md.',
    hint: 'Best with an errorreport.md file attached',
  },
  {
    id: 'implement_todo',
    label: 'Implement tasks from todo.md',
    icon: '✅',
    prompt: 'Read the attached todo.md file. Implement each task in order of priority. Mark completed tasks and create output files for each deliverable.',
    hint: 'Best with todo.md attached',
  },
  {
    id: 'build_feature',
    label: 'Build feature from plan',
    icon: '🏗️',
    prompt: 'Read the attached plan/spec. Implement the described feature with clean, production-ready code. Include tests and a brief summary in output/feature-summary.md.',
    hint: 'Best with plan.md or spec.md attached',
  },
  {
    id: 'code_review',
    label: 'Code review & improvements',
    icon: '🔍',
    prompt: 'Review the attached code or project files. Identify code quality issues, security vulnerabilities, and performance bottlenecks. Output a detailed review in output/code-review.md with suggested fixes.',
    hint: 'Attach source files for review',
  },
  {
    id: 'status_report',
    label: 'Create status report',
    icon: '📝',
    prompt: 'Analyze the current project state from attached files. Generate a concise status report in output/status.md covering: completed work, in-progress items, blockers, and next steps.',
  },
  {
    id: 'write_tests',
    label: 'Write & run tests',
    icon: '🧪',
    prompt: 'Review the attached code and create comprehensive test cases. Write unit tests, integration tests, and edge case coverage. Save tests to output/tests/ and provide a test summary.',
    hint: 'Attach source code files',
  },
  {
    id: 'refactor',
    label: 'Refactor & optimize',
    icon: '🔧',
    prompt: 'Analyze the attached code for refactoring opportunities. Improve code structure, reduce duplication, optimize performance, and document significant changes in output/refactor-notes.md.',
    hint: 'Attach files to refactor',
  },
  {
    id: 'generate_docs',
    label: 'Generate documentation',
    icon: '📚',
    prompt: 'Read the attached source files and generate comprehensive API/technical documentation. Include function descriptions, parameters, examples, and usage guides. Save to output/docs/.',
    hint: 'Attach source files to document',
  },
  {
    id: 'security_audit',
    label: 'Security audit',
    icon: '🔒',
    prompt: 'Perform a security audit on the attached files. Check for: SQL injection, XSS, auth vulnerabilities, insecure dependencies, exposed secrets, and OWASP Top 10 issues. Report in output/security-audit.md.',
    hint: 'Attach code or config files',
  },
  {
    id: 'custom',
    label: 'Custom task…',
    icon: '✏️',
    prompt: '',
    hint: 'Write your own task description',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ts?: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function elapsed(run: OrchestratorRun) {
  if (!run.started_at) return ''
  const end = run.completed_at || Math.floor(Date.now() / 1000)
  const s = end - run.started_at
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ─── Run meta helpers ─────────────────────────────────────────────────────────

interface RunMeta {
  model?: string
  taskType?: string
  cleanDescription: string
}

function parseRunMeta(description: string): RunMeta {
  const match = description.match(/^\[🤖 Model: ([^\s|]+) \| 📋 Type: ([^\]]+)\]\n\n/)
  if (!match) return { cleanDescription: description }
  return {
    model: match[1],
    taskType: match[2],
    cleanDescription: description.slice(match[0].length),
  }
}

// ─── Client-side task type detection ──────────────────────────────────────────

type ClientTaskType = 'coding' | 'writing' | 'analysis' | 'devops' | 'research' | 'general'

const CLIENT_TASK_KEYWORDS: Record<ClientTaskType, string[]> = {
  coding:   ['fix', 'bug', 'implement', 'refactor', 'function', 'api', 'test', 'code', 'script', 'error', 'crash', 'debug', 'feature', 'class', 'module', 'compile', 'build', 'typescript', 'javascript', 'python'],
  writing:  ['write', 'document', 'readme', 'docs', 'comment', 'explain', 'describe', 'summary', 'report', 'changelog', 'guide', 'tutorial', 'draft'],
  analysis: ['analyze', 'review', 'audit', 'check', 'inspect', 'evaluate', 'assess', 'performance', 'security', 'quality', 'scan', 'profile', 'diagnose'],
  devops:   ['deploy', 'docker', 'pipeline', 'server', 'config', 'setup', 'install', 'migrate', 'database', 'infra', 'ci', 'cd', 'kubernetes', 'helm', 'terraform', 'nginx'],
  research: ['research', 'find', 'search', 'investigate', 'explore', 'compare', 'benchmark', 'discover', 'survey', 'gather'],
  general:  [],
}

const CLIENT_MODEL_MAP: Record<ClientTaskType, string> = {
  coding:   'llama-3.3-70b-versatile',
  writing:  'llama-3.1-8b-instant',
  analysis: 'llama-3.3-70b-versatile',
  devops:   'llama-3.3-70b-versatile',
  research: 'llama-3.1-70b-versatile',
  general:  'llama3-8b-8192',
}

function detectClientTaskType(text: string): ClientTaskType {
  const words = text.toLowerCase().match(/\b\w+\b/g) ?? []
  let best: ClientTaskType = 'general'
  let bestScore = 0
  for (const [type, keywords] of Object.entries(CLIENT_TASK_KEYWORDS) as [ClientTaskType, string[]][]) {
    if (type === 'general') continue
    const score = words.filter(w => keywords.includes(w)).length
    if (score > bestScore) { bestScore = score; best = type }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────

function parseActiveAgents(output: string): Set<string> {
  const found = new Set<string>()
  for (const name of TEAM_NAMES) {
    if (output.includes(`[${name}]`)) found.add(name)
  }
  return found
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'bg-blue-500/20 text-blue-400 animate-pulse',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />}
      {status}
    </span>
  )
}

function AgentDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    busy: 'bg-yellow-400 animate-pulse',
    idle: 'bg-green-400',
    offline: 'bg-gray-500',
    error: 'bg-red-400',
  }
  return <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${colors[status] ?? 'bg-gray-500'}`} />
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function OrchestratorRunPanel() {
  const [projects, setProjects] = useState<OrchestratorProject[]>([])
  const [runs, setRuns] = useState<OrchestratorRun[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [activeRun, setActiveRun] = useState<OrchestratorRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Task composition
  const [templateId, setTemplateId] = useState<string>('fix_errors')
  const [customPrompt, setCustomPrompt] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [suggestedFiles, setSuggestedFiles] = useState<SuggestedFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [autoAttachReferencePack, setAutoAttachReferencePack] = useState(true)
  const [autoAttachLearnedMemory, setAutoAttachLearnedMemory] = useState(true)
  const [autoContextSaving, setAutoContextSaving] = useState(false)

  // Team members state
  const [teamAgents, setTeamAgents] = useState<TeamAgent[]>([])
  const [teamLeadMode, setTeamLeadMode] = useState(false)
  const [teamLeadSaving, setTeamLeadSaving] = useState(false)

  // Register project form
  const [showRegister, setShowRegister] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
  const [regName, setRegName] = useState('')
  const [regFolder, setRegFolder] = useState('D:\\01 Main Work\\Boots\\Agentic AI\\ai-orchestrator')
  const [regDesc, setRegDesc] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState('')
  const [openingChat, setOpeningChat] = useState(false)

  const outputRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load projects + runs
  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator', { headers: AUTH_HEADER })
      if (!res.ok) return
      const data = await res.json()
      setProjects(data.projects ?? [])
      setRuns(data.runs ?? [])
    } catch { /* ignore */ }
  }, [])

  // Load team agents
  const loadTeam = useCallback(async () => {
    try {
      const res = await fetch('/api/agents', { headers: AUTH_HEADER })
      if (!res.ok) return
      const data = await res.json()
      const team = (data.agents ?? []).filter((a: TeamAgent) => TEAM_NAMES.includes(a.name))
      setTeamAgents(team)
    } catch { /* ignore */ }
  }, [])

  // Load Team Lead Mode setting
  const loadOrchestratorSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings?category=orchestrator', { headers: AUTH_HEADER })
      if (!res.ok) return
      const data = await res.json()
      const settings = data.settings ?? []
      const setting = settings.find((s: any) => s.key === 'orchestrator.team_lead_mode')
      setTeamLeadMode(setting?.value === 'true')
      setAutoAttachReferencePack(settings.find((s: any) => s.key === 'orchestrator.auto_attach_reference_pack')?.value !== 'false')
      setAutoAttachLearnedMemory(settings.find((s: any) => s.key === 'orchestrator.auto_attach_learned_memory')?.value !== 'false')
    } catch { /* ignore */ }
  }, [])

  // Load suggested files for selected project
  const loadSuggestedFiles = useCallback(async (projectId: number, taskPreview = '', resetSelection = false) => {
    setLoadingFiles(true)
    setSuggestedFiles([])
    if (resetSelection) setSelectedFiles(new Set())
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    try {
      const query = taskPreview.trim() ? `&task=${encodeURIComponent(taskPreview.trim())}` : ''
      const res = await fetch(`/api/orchestrator?project_id=${projectId}${query}`, {
        headers: AUTH_HEADER,
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to scan project files')
        if (data.project) {
          setProjects(prev => prev.map(project => project.id === data.project.id ? data.project : project))
        }
        return
      }
      setError('')
      if (data.project) {
        setProjects(prev => prev.map(project => project.id === data.project.id ? data.project : project))
      }
      setSuggestedFiles(data.suggestedFiles ?? [])
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setError('Project scan timed out. Narrow the folder or refresh again.')
      }
    } finally {
      clearTimeout(timeout)
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    loadTeam()
    loadOrchestratorSettings()
  }, [loadData, loadTeam, loadOrchestratorSettings])

  // Refresh team agents every 15s
  useEffect(() => {
    const iv = setInterval(loadTeam, 15000)
    return () => clearInterval(iv)
  }, [loadTeam])

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      const firstProject = projects.find(project => project.runnable !== false) || projects[0]
      const firstId = firstProject.id
      setSelectedProjectId(firstId)
      loadSuggestedFiles(firstId, '', true)
    }
  }, [projects, selectedProjectId, loadSuggestedFiles])

  // Poll active run
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!activeRunId) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/orchestrator?runId=${activeRunId}`, { headers: AUTH_HEADER })
        if (!res.ok) return
        const data = await res.json()
        const run: OrchestratorRun = data.run
        setActiveRun(run)
        setRuns(prev => prev.map(r => r.id === run.id ? { ...r, status: run.status, output: run.output } : r))
        if (run.status !== 'running') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          loadData()
          loadTeam()
        }
      } catch { /* ignore */ }
    }

    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeRunId, loadData, loadTeam])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [activeRun?.output])

  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const runnableProjects = projects.filter(project => project.runnable !== false)
  const brokenProjects = projects.filter(project => project.runnable === false)
  const projectRuns = runs.filter(r => r.project_id === selectedProjectId || (!r.project_id && selectedProject && r.folder === selectedProject.folder))
  const currentTemplate = TASK_TEMPLATES.find(t => t.id === templateId) ?? TASK_TEMPLATES[0]
  const taskPromptPreview = templateId === 'custom' ? customPrompt.trim() : currentTemplate.prompt
  const runActiveAgents = activeRun?.output ? parseActiveAgents(activeRun.output) : new Set<string>()
  const techLead = teamAgents.find(a => a.name === 'TechLead')
  const subAgents = teamAgents.filter(a => a.name !== 'TechLead')
  const autoContextFiles = suggestedFiles.filter((file) => file.source === 'reference-pack' || file.source === 'learned-memory')
  const projectReferenceFiles = suggestedFiles.filter((file) => !file.source || file.source === 'project')
  const selectedProjectRunnable = !!selectedProject && selectedProject.runnable !== false
  const templateRequiresTodo = templateId === 'implement_todo'
  const hasTodoAttachment = Array.from(selectedFiles).some((filePath) => /(^|[\\/])todo\.md$/i.test(filePath))
  const taskAwarePreview = templateId === 'custom' ? customPrompt.trim() : ''

  useEffect(() => {
    if (!selectedProjectId) return
    const timeout = setTimeout(() => {
      loadSuggestedFiles(selectedProjectId, taskAwarePreview, false)
    }, 250)
    return () => clearTimeout(timeout)
  }, [loadSuggestedFiles, selectedProjectId, taskAwarePreview, autoAttachLearnedMemory, autoAttachReferencePack])

  // Build the final task string from template + selected files
  function buildTaskString(): string {
    const prompt = templateId === 'custom' ? customPrompt.trim() : currentTemplate.prompt
    if (!prompt) return ''

    const fileLines = Array.from(selectedFiles)
      .map(f => `/inini "${f}"`)
      .join('\n')

    return fileLines ? `${fileLines}\n\n${prompt}` : prompt
  }

  function toggleFile(path: string) {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function toggleTeamLeadMode() {
    setTeamLeadSaving(true)
    const newVal = !teamLeadMode
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ settings: { 'orchestrator.team_lead_mode': String(newVal) } }),
      })
      setTeamLeadMode(newVal)
    } catch { /* ignore */ } finally {
      setTeamLeadSaving(false)
    }
  }

  async function updateAutoContextSettings(next: { referencePack?: boolean; learnedMemory?: boolean }) {
    setAutoContextSaving(true)
    const nextReference = next.referencePack ?? autoAttachReferencePack
    const nextLearned = next.learnedMemory ?? autoAttachLearnedMemory
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          settings: {
            'orchestrator.auto_attach_reference_pack': String(nextReference),
            'orchestrator.auto_attach_learned_memory': String(nextLearned),
          },
        }),
      })
      if (!res.ok) return
      setAutoAttachReferencePack(nextReference)
      setAutoAttachLearnedMemory(nextLearned)
      if (selectedProjectId) {
        loadSuggestedFiles(selectedProjectId, taskAwarePreview, false)
      }
    } catch {
      // ignore
    } finally {
      setAutoContextSaving(false)
    }
  }

  async function startRun() {
    if (!selectedProject) return
    if (selectedProject.runnable === false) {
      setError(selectedProject.issue || 'Project folder is not available')
      return
    }
    if (templateRequiresTodo && !hasTodoAttachment) {
      setError('Attach at least one todo.md file before running this task')
      return
    }
    const finalTask = buildTaskString()
    if (!finalTask) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          action: 'run',
          folder: selectedProject.folder,
          task: finalTask,
          project_id: selectedProject.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to start run'); return }
      setActiveRunId(data.run_id)
      setActiveRun(null)
      await loadData()
      loadTeam()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function registerProject() {
    if (!regName.trim() || !regFolder.trim()) return
    setRegLoading(true)
    setRegError('')
    try {
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          action: 'register_project',
          id: editingProjectId,
          name: regName.trim(),
          folder: regFolder.trim(),
          description: regDesc.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setRegError(data.error || 'Failed'); return }
      setShowRegister(false)
      setEditingProjectId(null)
      setRegName(''); setRegDesc('')
      await loadData()
      if (data.project?.id) {
        setSelectedProjectId(data.project.id)
        loadSuggestedFiles(data.project.id, taskPromptPreview, true)
      }
    } catch (e: any) {
      setRegError(e.message)
    } finally {
      setRegLoading(false)
    }
  }

  async function deleteProject(id: number) {
    if (!confirm('Remove this project from Mission Control? (Files are not deleted)')) return
    await fetch(`/api/orchestrator?projectId=${id}`, { method: 'DELETE', headers: AUTH_HEADER })
    if (selectedProjectId === id) { setSelectedProjectId(null); setSuggestedFiles([]) }
    await loadData()
  }

  function editProject(project: OrchestratorProject) {
    setEditingProjectId(project.id)
    setRegName(project.name)
    setRegFolder(project.folder)
    setRegDesc(project.description || '')
    setRegError('')
    setShowRegister(true)
  }

  async function refreshSelectedProject() {
    if (!selectedProject) return
    setError('')
    await loadData()
    await loadSuggestedFiles(selectedProject.id, taskPromptPreview, false)
  }

  async function refreshProjects() {
    setError('')
    await loadData()
    if (selectedProjectId) {
      await loadSuggestedFiles(selectedProjectId, taskPromptPreview, false)
    }
  }

  async function viewRun(run: OrchestratorRun) {
    setActiveRun(run)
    if (run.status === 'running') {
      setActiveRunId(run.id)
    } else {
      setActiveRunId(null)
      try {
        const res = await fetch(`/api/orchestrator?runId=${run.id}`, { headers: AUTH_HEADER })
        if (res.ok) {
          const data = await res.json()
          setActiveRun(data.run)
        }
      } catch { /* ignore */ }
    }
  }

  const canRun = !!selectedProject
    && selectedProjectRunnable
    && !loading
    && (templateId === 'custom' ? customPrompt.trim().length > 0 : true)
    && (!templateRequiresTodo || hasTodoAttachment)
  const displayRun = activeRun

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* ── Left sidebar ── */}
      <aside className="w-60 shrink-0 border-r border-border flex flex-col bg-card">
        {/* Projects header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Projects</span>
          <div className="flex items-center gap-1">
            <button
              onClick={refreshProjects}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              title="Refresh projects"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M13 3v4H9" />
                <path d="M3 13V9h4" />
                <path d="M4.5 6.5A4.5 4.5 0 0112 5l1 2" />
                <path d="M11.5 9.5A4.5 4.5 0 014 11l-1-2" />
              </svg>
            </button>
            <button
              onClick={() => {
                if (showRegister) {
                  setShowRegister(false)
                  setEditingProjectId(null)
                  setRegError('')
                } else {
                  setEditingProjectId(null)
                  setRegName('')
                  setRegFolder('D:\\01 Main Work\\Boots\\Agentic AI\\ai-orchestrator')
                  setRegDesc('')
                  setRegError('')
                  setShowRegister(true)
                }
              }}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              title="Register project"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 px-3 py-2 border-b border-border shrink-0 bg-muted/20">
          <div className="rounded border border-border bg-background/60 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Runnable</div>
            <div className="mt-1 text-xs font-semibold text-green-400">{runnableProjects.length}</div>
          </div>
          <div className="rounded border border-border bg-background/60 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Broken</div>
            <div className="mt-1 text-xs font-semibold text-red-400">{brokenProjects.length}</div>
          </div>
        </div>

        {/* Register form */}
        {showRegister && (
          <div className="px-3 py-2.5 border-b border-border bg-muted/30 space-y-2 shrink-0">
            <p className="text-xs font-medium text-foreground">{editingProjectId ? 'Update Orchestrator Project' : 'Register Orchestrator Project'}</p>
            <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="Name"
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            <input value={regFolder} onChange={e => setRegFolder(e.target.value)} placeholder="Folder path"
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
            <input value={regDesc} onChange={e => setRegDesc(e.target.value)} placeholder="Description (optional)"
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            {regError && <p className="text-xs text-red-400">{regError}</p>}
            <div className="flex gap-1.5">
              <button onClick={registerProject} disabled={regLoading || !regName.trim() || !regFolder.trim()}
                className="flex-1 py-1 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-smooth">
                {regLoading ? 'Saving…' : editingProjectId ? 'Save' : 'Register'}
              </button>
              <button onClick={() => { setShowRegister(false); setEditingProjectId(null) }}
                className="px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground transition-smooth">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Project list */}
        <div className="overflow-y-auto py-1 max-h-52 shrink-0">
          {projects.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No projects yet.{' '}
              <button onClick={() => setShowRegister(true)} className="text-primary underline">Add one</button>
            </p>
          )}
          {runnableProjects.length > 0 && (
            <div className="px-3 pt-1 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground">Runnable projects</div>
          )}
          {runnableProjects.map(p => (
            <div key={p.id} role="button" tabIndex={0}
              onClick={() => { setSelectedProjectId(p.id); setActiveRun(null); setActiveRunId(null); loadSuggestedFiles(p.id, taskPromptPreview, true) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setSelectedProjectId(p.id); setActiveRun(null); setActiveRunId(null); loadSuggestedFiles(p.id, taskPromptPreview, true) } }}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 group transition-smooth cursor-pointer ${selectedProjectId === p.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 mt-0.5 shrink-0">
                <rect x="1" y="3" width="14" height="11" rx="1.5" />
                <path d="M1 6h14M5 3V1" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground truncate font-mono">{p.folder.split(/[\\/]/).pop()}</div>
                {p.runnable === false && (
                  <div className="mt-1 text-[9px] text-red-400 truncate">{p.issue || 'Folder unavailable'}</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={e => { e.stopPropagation(); editProject(p) }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-muted-foreground hover:text-foreground transition-smooth" title="Edit project">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M11.5 2.5l2 2L6 12l-3 .5.5-3 8-7z" />
                  </svg>
                </button>
                <button onClick={e => { e.stopPropagation(); deleteProject(p.id) }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-muted-foreground hover:text-red-400 transition-smooth" title="Remove project">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {brokenProjects.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-red-400/80">Broken projects</div>
          )}
          {brokenProjects.map(p => (
            <div key={p.id} role="button" tabIndex={0}
              onClick={() => { setSelectedProjectId(p.id); setActiveRun(null); setActiveRunId(null); setSuggestedFiles([]); setError(p.issue || 'Project folder is unavailable') }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setSelectedProjectId(p.id); setActiveRun(null); setActiveRunId(null); setSuggestedFiles([]); setError(p.issue || 'Project folder is unavailable') } }}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 group transition-smooth cursor-pointer ${selectedProjectId === p.id ? 'bg-red-500/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400">
                <path d="M8 1.5l6 11H2l6-11z" />
                <path d="M8 5.5v3.5M8 11.25h.01" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium truncate">{p.name}</div>
                  <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] text-red-400">broken</span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate font-mono">{p.folder}</div>
                <div className="mt-1 text-[9px] text-red-400 truncate">{p.issue || 'Folder unavailable'}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={e => { e.stopPropagation(); editProject(p) }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-muted-foreground hover:text-foreground transition-smooth" title="Repair project">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M11.5 2.5l2 2L6 12l-3 .5.5-3 8-7z" />
                  </svg>
                </button>
                <button onClick={e => { e.stopPropagation(); deleteProject(p.id) }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded text-muted-foreground hover:text-red-400 transition-smooth" title="Remove project">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── AI Team section ── */}
        <div className="border-t border-border shrink-0">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">AI Team</span>
            {techLead && (
              <div className="flex items-center gap-1">
                <AgentDot status={techLead.status} />
                <span className="text-[10px] text-muted-foreground">TechLead</span>
              </div>
            )}
          </div>
          {subAgents.length > 0 ? (
            <div className="px-3 pb-2 grid grid-cols-2 gap-1">
              {subAgents.map(agent => {
                const isRunActive = runActiveAgents.has(agent.name)
                return (
                  <div key={agent.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border transition-smooth ${isRunActive ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400' : agent.status === 'busy' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/70' : 'border-border bg-secondary/30 text-muted-foreground'}`}
                    title={agent.role}>
                    <AgentDot status={isRunActive ? 'busy' : agent.status} />
                    <span className="truncate font-medium">{agent.name}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="px-3 pb-2 text-[10px] text-muted-foreground/60">Team appears after first run</p>
          )}
        </div>

        {/* ── Run history ── */}
        {selectedProject && (
          <>
            <div className="px-3 py-2 border-t border-border shrink-0">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Run History</span>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 border-t border-border">
              {projectRuns.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground text-center">No runs yet</p>}
              {projectRuns.map(run => (
                <button key={run.id} onClick={() => viewRun(run)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-smooth ${activeRun?.id === run.id ? 'bg-primary/10' : 'hover:bg-secondary'}`}>
                  <StatusBadge status={run.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground truncate">{run.task_description}</div>
                    <div className="text-[10px] text-muted-foreground">{fmt(run.started_at)} · {elapsed(run)}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-primary shrink-0">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" />
          </svg>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">{selectedProject ? selectedProject.name : 'AI Orchestrator'}</h2>
            {selectedProject && <p className="text-[10px] text-muted-foreground font-mono truncate">{selectedProject.folder}</p>}
            {selectedProject && selectedProject.runnable === false && (
              <p className="text-[10px] text-red-400 mt-0.5">{selectedProject.issue || 'Folder unavailable. Replace the folder or remove this project.'}</p>
            )}
          </div>

          {/* Team Lead Mode toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {selectedProject && (
              <>
                <button
                  onClick={refreshSelectedProject}
                  className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Refresh
                </button>
                <button
                  onClick={() => editProject(selectedProject)}
                  className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Replace Folder
                </button>
              </>
            )}
            <span className="text-[10px] text-muted-foreground">Team Lead Mode</span>
            <button onClick={toggleTeamLeadMode} disabled={teamLeadSaving}
              title={teamLeadMode ? 'Team Lead Mode ON — all inbox tasks auto-dispatch' : 'Team Lead Mode OFF — only todo_sync tasks'}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${teamLeadMode ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${teamLeadMode ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {!selectedProject ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-muted-foreground">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground">No project selected</p>
              <p className="text-xs text-muted-foreground">Register your AI Orchestrator folder to get started</p>
              <button onClick={() => setShowRegister(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-smooth">
                Register Project
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Task Composer ── */}
            <div className="px-5 py-4 border-b border-border bg-card shrink-0 space-y-3">
              {!selectedProjectRunnable && (
                <div className="flex items-center gap-2 px-2 py-2 rounded bg-red-500/10 border border-red-500/20">
                  <span className="text-[10px] text-red-400 font-medium">Project unavailable</span>
                  <span className="text-[10px] text-muted-foreground flex-1">
                    {selectedProject?.issue || 'Folder unavailable.'} Refresh to re-check or replace the folder path.
                  </span>
                </div>
              )}
              {teamLeadMode && (
                <div className="flex items-center gap-2 px-2 py-1 rounded bg-primary/10 border border-primary/20">
                  <span className="text-[10px] text-primary font-medium">⚡ Team Lead Mode</span>
                  <span className="text-[10px] text-muted-foreground flex-1">Scheduler auto-dispatches all inbox tasks to the orchestrator every 60s</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* LEFT: Task dropdown */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Task Type</label>
                  <div className="relative">
                    <select
                      value={templateId}
                      onChange={e => setTemplateId(e.target.value)}
                      className="w-full appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                    >
                      {TASK_TEMPLATES.map(t => (
                        <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                      ))}
                    </select>
                    <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </div>

                  {/* Template hint */}
                  {currentTemplate.hint && templateId !== 'custom' && (
                    <p className="text-[10px] text-muted-foreground/70 italic">{currentTemplate.hint}</p>
                  )}
                  {templateRequiresTodo && !hasTodoAttachment && (
                    <p className="text-[10px] text-amber-400">
                      Attach a real `todo.md` file before running this task.
                    </p>
                  )}

                  {/* Template preview / custom textarea */}
                  {templateId === 'custom' ? (
                    <textarea
                      value={customPrompt}
                      onChange={e => setCustomPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startRun() }}
                      placeholder="Describe your custom task… (Ctrl+Enter to run)"
                      rows={5}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground leading-relaxed max-h-[100px] overflow-y-auto">
                      {currentTemplate.prompt}
                    </div>
                  )}
                </div>

                {/* RIGHT: File selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Reference Files</label>
                    {selectedFiles.size > 0 && (
                      <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded">{selectedFiles.size} selected</span>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <div className="rounded-lg border border-border bg-secondary/20 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-foreground">Auto Context: Reference Pack</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">Inject standard repo patterns and best-practice files.</p>
                        </div>
                        <button
                          onClick={() => updateAutoContextSettings({ referencePack: !autoAttachReferencePack })}
                          disabled={autoContextSaving}
                          className={`rounded px-2 py-1 text-[9px] ${autoAttachReferencePack ? 'bg-cyan-500/15 text-cyan-400' : 'bg-muted text-muted-foreground'}`}
                        >
                          {autoAttachReferencePack ? 'on' : 'off'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-secondary/20 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-foreground">Auto Context: Learned Memory</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">Inject compact project memory ranked against the current task.</p>
                        </div>
                        <button
                          onClick={() => updateAutoContextSettings({ learnedMemory: !autoAttachLearnedMemory })}
                          disabled={autoContextSaving}
                          className={`rounded px-2 py-1 text-[9px] ${autoAttachLearnedMemory ? 'bg-amber-500/15 text-amber-400' : 'bg-muted text-muted-foreground'}`}
                        >
                          {autoAttachLearnedMemory ? 'on' : 'off'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {autoContextFiles.length > 0 && (
                    <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-foreground">Auto-loaded by server</span>
                        <span className="text-[9px] text-muted-foreground">{autoContextFiles.length} source{autoContextFiles.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-1">
                        {autoContextFiles.map(file => (
                          <div key={file.path} className="rounded border border-border/60 bg-background/40 px-2 py-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-medium text-foreground">{file.name}</span>
                              <span className={`text-[9px] ${file.source === 'learned-memory' ? 'text-amber-400' : 'text-cyan-400'}`}>
                                {file.source === 'learned-memory' ? 'learned memory' : 'reference pack'}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[9px] text-muted-foreground">{file.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadingFiles ? (
                    <div className="flex items-center gap-2 py-4">
                      <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="text-[10px] text-muted-foreground">Scanning project files…</span>
                    </div>
                  ) : !selectedProjectRunnable ? (
                    <p className="text-[10px] text-red-400/90 py-2">This project cannot be scanned until the folder path is fixed.</p>
                  ) : projectReferenceFiles.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/60 py-2">No files found. Register project first.</p>
                  ) : (
                    <div className="space-y-1">
                      {projectReferenceFiles.map(file => (
                        <label key={file.path}
                          className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-smooth select-none ${selectedFiles.has(file.path) ? 'border-primary/50 bg-primary/8 text-foreground' : 'border-border bg-secondary/20 text-muted-foreground hover:text-foreground hover:bg-secondary/40'}`}>
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(file.path)}
                            onChange={() => toggleFile(file.path)}
                            className="mt-0.5 w-3 h-3 rounded accent-primary shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-medium truncate">{file.name}</span>
                              <span className="text-[9px] text-muted-foreground/70 shrink-0">{file.reason}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground/50 truncate font-mono mt-0.5" title={file.path}>
                              {file.path.replace(/\\/g, '/').split('/').slice(-3).join('/')}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Run button row */}
              <div className="flex items-center justify-between pt-1">
                {/* Auto-detection preview badges */}
                {(() => {
                  const taskText = templateId === 'custom' ? customPrompt : currentTemplate.prompt
                  const detectedType = detectClientTaskType(taskText)
                  const detectedModel = CLIENT_MODEL_MAP[detectedType]
                  const shortModel = detectedModel.replace('llama-', 'l').replace('-versatile', '-v').replace('-instant', '-i')
                  return (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded font-mono" title={`Auto-selected model: ${detectedModel}`}>
                        🤖 {shortModel}
                      </span>
                      <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded" title="Detected task type">
                        📋 {detectedType}
                      </span>
                      {selectedFiles.size > 0 && (
                        <span className="text-[10px] text-muted-foreground">{selectedFiles.size} file{selectedFiles.size > 1 ? 's' : ''} attached</span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40" title="Auto context injected by the server when enabled">
                        · pack {autoAttachReferencePack ? '✓' : '×'} · memory {autoAttachLearnedMemory ? '✓' : '×'}
                      </span>
                    </div>
                  )
                })()}

                <div className="flex items-center gap-2">
                  {error && <p className="text-[10px] text-red-400">{error}</p>}
                  <button
                    onClick={async () => {
                      if (openingChat) return
                      setOpeningChat(true)
                      try {
                        await openOrchestratorChat()
                      } finally {
                        setOpeningChat(false)
                      }
                    }}
                    disabled={openingChat}
                    className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth disabled:opacity-60"
                    title="Open orchestrator chat and wake coordinator if needed"
                  >
                    {openingChat ? 'Waking chat...' : 'Chat with Orchestrator'}
                  </button>
                  <button
                    onClick={startRun}
                    disabled={!canRun}
                    className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-smooth flex items-center gap-1.5"
                    title={selectedProjectRunnable ? 'Run task' : (selectedProject?.issue || 'Project folder unavailable')}
                  >
                    {loading ? (
                      <>
                        <span className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        Starting…
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                          <path d="M4 3l9 5-9 5V3z" fill="currentColor" stroke="none" />
                        </svg>
                        Run Task
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Output area ── */}
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 flex flex-col min-h-0">
                {displayRun ? (
                  <>
                    {/* Run info bar */}
                    <div className="flex items-center gap-3 px-4 py-1.5 bg-muted/30 border-b border-border shrink-0 flex-wrap">
                      <StatusBadge status={displayRun.status} />
                      {displayRun.grade != null && <GradeBadge grade={displayRun.grade} />}
                      {(() => {
                        const meta = parseRunMeta(displayRun.task_description)
                        const shortModel = meta.model?.replace('llama-', 'l').replace('-versatile', '-v').replace('-instant', '-i')
                        return (
                          <>
                            {meta.model && (
                              <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded font-mono shrink-0" title={`Model: ${meta.model}`}>
                                🤖 {shortModel}
                              </span>
                            )}
                            {meta.taskType && (
                              <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded shrink-0">
                                📋 {meta.taskType}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                              {meta.cleanDescription.slice(0, 80)}{meta.cleanDescription.length > 80 ? '…' : ''}
                            </span>
                          </>
                        )
                      })()}
                      <span className="text-[10px] text-muted-foreground shrink-0">{fmt(displayRun.started_at)} · {elapsed(displayRun)}</span>
                      {displayRun.exit_code !== undefined && displayRun.exit_code !== null && (
                        <span className={`text-[10px] font-mono shrink-0 ${displayRun.exit_code === 0 ? 'text-green-400' : 'text-red-400'}`}>exit {displayRun.exit_code}</span>
                      )}
                      {displayRun.task_id && (
                        <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded shrink-0">task #{displayRun.task_id}</span>
                      )}
                      {runActiveAgents.size > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          {Array.from(runActiveAgents).map(name => (
                            <span key={name} className="text-[9px] bg-yellow-500/15 text-yellow-400 px-1 py-0.5 rounded font-mono">{name}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Terminal */}
                    <div ref={outputRef}
                      className={`overflow-y-auto bg-[#0d1117] text-green-400 font-mono text-[11px] leading-relaxed p-4 min-h-0 ${(displayRun.audit_notes || displayRun.lesson) && displayRun.status !== 'running' ? 'flex-1 max-h-[55%]' : 'flex-1'}`}>
                      {displayRun.output ? (
                        <pre className="whitespace-pre-wrap break-words">{displayRun.output}</pre>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
                          Waiting for output…
                        </div>
                      )}
                      {displayRun.status === 'running' && (
                        <span className="inline-block w-2 h-3.5 bg-green-400 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>

                    {/* Audit notes */}
                    {displayRun.audit_notes && displayRun.status !== 'running' && (
                      <div className="shrink-0 border-t border-border bg-card px-4 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Audit Report</span>
                          {displayRun.grade != null && (
                            <span className={`text-[10px] font-bold ${displayRun.grade >= 8 ? 'text-green-400' : displayRun.grade >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {displayRun.grade}/10
                            </span>
                          )}
                        </div>
                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{displayRun.audit_notes}</pre>
                      </div>
                    )}

                    {/* Lesson */}
                    {displayRun.lesson && displayRun.status !== 'running' && (
                      <div className="shrink-0 border-t border-border bg-primary/5 px-4 py-2">
                        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider mr-2">💡 Lesson</span>
                        <span className="text-[10px] text-muted-foreground">{displayRun.lesson}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
                    <div className="text-center space-y-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-green-800 mx-auto">
                        <rect x="2" y="3" width="20" height="15" rx="2" />
                        <path d="M8 21h8M12 18v3M7 8l3 3-3 3M13 14h4" />
                      </svg>
                      {teamLeadMode
                        ? <p className="text-xs text-green-900">⚡ Team Lead Mode — scheduler auto-dispatches inbox tasks</p>
                        : <p className="text-xs text-green-900">Select a task type and files, then press Run Task</p>
                      }
                    </div>
                  </div>
                )}
              </div>

              {/* Files sidebar */}
              {displayRun?.files && displayRun.files.length > 0 && (
                <aside className="w-52 shrink-0 border-l border-border flex flex-col bg-card">
                  <div className="px-3 py-2 border-b border-border shrink-0">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Generated Files ({displayRun.files.length})
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto py-1">
                    {displayRun.files.map((f, i) => {
                      const name = f.split(/[\\/]/).pop() || f
                      const ext = name.split('.').pop()?.toLowerCase()
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary transition-smooth">
                          <FileIcon ext={ext} />
                          <span className="text-xs text-foreground truncate flex-1" title={f}>{name}</span>
                        </div>
                      )
                    })}
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function GradeBadge({ grade }: { grade: number }) {
  const color = grade >= 8 ? 'bg-green-500/20 text-green-400' : grade >= 5 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
  const label = grade >= 8 ? '🟢' : grade >= 5 ? '🟡' : '🔴'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>
      {label} {grade}/10
    </span>
  )
}

function FileIcon({ ext }: { ext?: string }) {
  const colors: Record<string, string> = { js: 'text-yellow-400', ts: 'text-blue-400', json: 'text-orange-400', md: 'text-green-400', txt: 'text-muted-foreground', py: 'text-blue-300', html: 'text-orange-300', css: 'text-pink-400' }
  const color = colors[ext ?? ''] ?? 'text-muted-foreground'
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 shrink-0 ${color}`}>
      <path d="M4 1h6l3 3v10a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" />
      <path d="M10 1v3h3" />
    </svg>
  )
}
