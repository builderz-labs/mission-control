'use client'

import { useState } from 'react'
import type { Project } from '@/store'
import type { JevSetupSession } from '@/lib/jev-setup-session-types'
import type { JevEvaluation, JevPolicy } from './jev-ui-types'

export type JevWorkspaceView = 'assistant' | 'evaluate' | 'policies' | 'history'

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function JevPolicyRail({
  projects,
  activeProjectId,
  policies,
  evaluations,
  sessions,
  selectedSessionId,
  selectedPolicyId,
  visibleQuestionIds,
  view,
  canManage,
  onProject,
  onNewSetup,
  onSession,
  onPolicy,
  onView,
  onToggleQuestion,
  onEditQuestion,
  onAddQuestion,
}: {
  projects: Project[]
  activeProjectId: number | null
  policies: JevPolicy[]
  evaluations: JevEvaluation[]
  sessions: JevSetupSession[]
  selectedSessionId: string | null
  selectedPolicyId: number | null
  visibleQuestionIds: Set<string>
  view: JevWorkspaceView
  canManage: boolean
  onProject: (project: Project) => void
  onNewSetup: () => void
  onSession: (session: JevSetupSession) => void
  onPolicy: (policy: JevPolicy) => void
  onView: (view: JevWorkspaceView) => void
  onToggleQuestion: (id: string) => void
  onEditQuestion: (policy: JevPolicy, id: string) => void
  onAddQuestion: (policy: JevPolicy) => void
}) {
  const selected = policies.find((policy) => policy.id === selectedPolicyId) ?? null
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const matchingProjects = projects.filter((project) => project.name.toLowerCase().includes(query)
    || sessions.some((session) => session.project_id === project.id && session.title.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.id === activeProjectId) - Number(a.id === activeProjectId) || a.name.localeCompare(b.name))
  return (
    <div className="flex h-full min-h-0 w-full flex-col text-[13px]">
      <div className="border-b border-[var(--chat-border)] px-3 py-3">
        <div className="flex items-center justify-between">
          <strong className="text-[var(--chat-text)]">Jev</strong>
          <button type="button" className="rounded-md bg-white/8 px-2 py-1 text-[12px] text-[var(--chat-text)] hover:bg-white/12" onClick={onNewSetup}>
            + New setup
          </button>
        </div>
        <nav aria-label="Jev workspace" className="mt-3 grid grid-cols-2 gap-1">
          {([
            ['assistant', 'Assistant'],
            ['evaluate', 'Evaluate'],
            ['policies', 'Policies'],
            ['history', 'History'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)} className={`rounded-md px-2 py-1.5 text-left text-[12px] ${view === id ? 'bg-white/10 text-[var(--chat-text)]' : 'text-[var(--chat-muted)] hover:bg-white/5 hover:text-[var(--chat-text)]'}`}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <RailHeading>Projects</RailHeading>
        <input aria-label="Search projects and setup chats" placeholder="Search projects and chats…" value={search}
          onChange={(event) => setSearch(event.target.value)} type="search"
          className="mb-3 w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-bg)] px-2 py-2 text-[12px] text-[var(--chat-text)]" />
        {matchingProjects.length === 0 && <p role="status" className="px-2 py-2 text-xs text-[var(--chat-muted)]">No projects or chats match your search.</p>}
        <div className="space-y-1">
          {matchingProjects.map((project) => {
            const active = project.id === activeProjectId
            return (
              <div key={project.id}>
                <button type="button" aria-current={active ? 'true' : undefined} title={project.name} onClick={() => onProject(project)} className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left ${active ? 'bg-white/8 text-[var(--chat-text)]' : 'text-[var(--chat-muted)] hover:bg-white/5'}`}>
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[var(--chat-accent)]' : 'bg-white/20'}`} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </button>
                {active && (policies.length > 0 || sessions.some((session) => session.project_id === project.id)) && (
                  <div className="ml-3 border-l border-[var(--chat-border)] pl-2">
                    {sessions.filter((session) => session.project_id === project.id).map((session) => (
                      <button key={session.id} type="button" onClick={() => onSession(session)} className={`flex min-h-8 w-full items-center rounded-md px-2 text-left text-[12px] ${session.id === selectedSessionId ? 'bg-white/5 text-[var(--chat-text)]' : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'}`}>
                        <span aria-hidden className="mr-2">✦</span><span className="truncate">{session.title}</span>
                      </button>
                    ))}
                    {policies.map((policy) => (
                      <button key={policy.id} type="button" onClick={() => onPolicy(policy)} className={`flex min-h-8 w-full items-center rounded-md px-2 text-left text-[12px] ${policy.id === selectedPolicyId ? 'text-[var(--chat-text)]' : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'}`}>
                        <span className={`mr-2 h-1.5 w-1.5 rounded-full ${policy.enabled ? 'bg-[var(--chat-success)]' : 'bg-white/20'}`} />
                        <span className="truncate">{policy.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {selected && view === 'policies' && (
          <section className="mt-5" aria-labelledby="jev-rail-questions">
            <div className="flex items-center justify-between px-2">
              <h2 id="jev-rail-questions" className="text-[12px] text-[var(--chat-muted)]">Result cards</h2>
              {canManage && <button type="button" className="rounded px-1 text-[12px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]" onClick={() => onAddQuestion(selected)}>+ Question</button>}
            </div>
            <div className="mt-1 space-y-0.5">
              {Object.entries(selected.questions).map(([id, question]) => (
                <div key={id} className="group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-white/5">
                  <input type="checkbox" className="mt-0.5" checked={visibleQuestionIds.has(id)} onChange={() => onToggleQuestion(id)} aria-label={`Show ${humanize(id)} result card`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--chat-text)]">{humanize(id)}</div>
                    <div className="text-[11px] text-[var(--chat-muted)]">{question.type === 'noul' ? 'Yes / No' : question.type === 'choice' ? 'Choose one' : 'Score'}</div>
                  </div>
                  {canManage && <button type="button" aria-label={`Edit ${humanize(id)}`} onClick={() => onEditQuestion(selected, id)} className="rounded px-1 text-[var(--chat-muted)] opacity-70 hover:text-[var(--chat-text)] group-hover:opacity-100">✎</button>}
                </div>
              ))}
            </div>
          </section>
        )}

        {evaluations.length > 0 && view !== 'assistant' && (
          <section className="mt-5">
            <RailHeading>Recent runs</RailHeading>
            {evaluations.slice(0, 5).map((evaluation) => (
              <button key={evaluation.id} type="button" onClick={() => onView('history')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--chat-muted)] hover:bg-white/5 hover:text-[var(--chat-text)]">
                <span className={evaluation.status === 'succeeded' ? 'text-[var(--chat-success)]' : evaluation.status === 'failed' ? 'text-[var(--chat-danger)]' : 'text-amber-300'}>●</span>
                <span className="min-w-0 flex-1 truncate">{evaluation.policy_name ?? 'Ad hoc run'}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--chat-muted)]">{children}</h2>
}
