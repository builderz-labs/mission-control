'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { JevHistory } from './jev-history'
import { JevPolicyForm } from './jev-policy-form'
import { JevPolicyList } from './jev-policy-list'
import { JevPolicyRail, type JevWorkspaceView } from './jev-policy-rail'
import { draftFromPolicy, emptyQuestion, questionsFromDrafts, type QuestionDraft } from './jev-policy-draft'
import { JevQuestionEditorDialog } from './jev-question-editor-dialog'
import { JevSetupAssistant } from './jev-setup-assistant'
import { JevSorterWorkspace } from './jev-sorter-workspace'
import { JevWorkspaceShell } from './jev-workspace-shell'
import type { JevPolicy, JevPolicyInput, JevQuestions } from './jev-ui-types'
import { useJevDashboard } from './use-jev-dashboard'
import { useJevSessions } from './use-jev-sessions'

interface QuestionEditorState {
  policy: JevPolicy
  originalId: string | null
  draft: QuestionDraft
}

const VIEW_TITLES: Record<JevWorkspaceView, string> = {
  assistant: 'Setup assistant', evaluate: 'Evaluate', policies: 'Policies', history: 'History',
}

export function JevPanel() {
  const { projects, activeProject, setActiveProject, fetchProjects, currentUser } = useMissionControl()
  const [view, setView] = useState<JevWorkspaceView>('assistant')
  const [editing, setEditing] = useState<JevPolicy | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [selectedPolicy, setSelectedPolicy] = useState<number | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [visibleQuestionIds, setVisibleQuestionIds] = useState<Set<string>>(new Set())
  const [questionEditor, setQuestionEditor] = useState<QuestionEditorState | null>(null)
  const project = useMemo(() => projects.find((item) => item.id === activeProject?.id) ?? projects[0] ?? null, [activeProject, projects])
  const data = useJevDashboard(project?.id ?? null)
  const sessionData = useJevSessions()
  const policies = useMemo(() => data.policies.filter((policy) => policy.project_id === project?.id), [data.policies, project?.id])
  const evaluations = useMemo(() => data.evaluations.filter((evaluation) => evaluation.project_id === project?.id), [data.evaluations, project?.id])
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'
  const selected = policies.find((policy) => policy.id === selectedPolicy) ?? null
  const questionSignature = selected ? `${selected.id}:${Object.keys(selected.questions).join('|')}` : ''
  const runDisabledReason = !canOperate
    ? 'Operator access is required to send an evaluation.'
    : !data.status?.configured ? 'Connect the TypeSafe credential before evaluating.'
      : !data.status.healthy ? 'The TypeSafe connection check failed. Retry status before evaluating.' : undefined
  const connectionStatus = !data.status ? 'Checking'
    : !data.status.healthy ? data.status.configured ? 'Needs attention' : 'Not configured'
      : data.status.cloud.state === 'synced' || data.status.cloud.state === 'ready' ? 'Connected · cloud synced'
        : data.status.cloud.state === 'pending' ? `Saved locally · ${data.status.cloud.pending} pending`
          : data.status.cloud.state === 'retrying' ? 'Saved locally · sync retrying' : 'Connected · local only'

  useEffect(() => { if (projects.length === 0) void fetchProjects() }, [fetchProjects, projects.length])
  useEffect(() => { if (project && activeProject?.id !== project.id) setActiveProject(project) }, [activeProject?.id, project, setActiveProject])
  useEffect(() => {
    const linked = sessionData.sessions.find((session) => session.id === selectedSession)?.primary_policy_id
    if (linked && policies.some((policy) => policy.id === linked) && linked !== selectedPolicy) {
      setSelectedPolicy(linked); return
    }
    if (selectedPolicy !== null && policies.some((policy) => policy.id === selectedPolicy)) return
    setSelectedPolicy(policies.find((policy) => policy.enabled)?.id ?? policies[0]?.id ?? null)
  }, [policies, selectedPolicy, selectedSession, sessionData.sessions])
  useEffect(() => {
    setVisibleQuestionIds(new Set(selected ? Object.keys(selected.questions) : []))
  }, [questionSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  const savePolicy = async (input: JevPolicyInput) => {
    if (editing) await data.updatePolicy(editing.id, input)
    else await data.createPolicy(input)
    setEditing(null); setShowForm(false)
  }
  const openQuestion = (policy: JevPolicy, id: string) => {
    const draft = draftFromPolicy(policy).find((item) => item.id === id)
    if (draft) setQuestionEditor({ policy, originalId: id, draft })
  }
  const addQuestion = (policy: JevPolicy) => {
    let index = 1
    while (policy.questions[index === 1 ? 'question' : `question_${index}`]) index += 1
    setQuestionEditor({ policy, originalId: null, draft: { ...emptyQuestion(), id: index === 1 ? 'question' : `question_${index}` } })
  }
  const saveQuestion = async (draft: QuestionDraft) => {
    if (!questionEditor) return
    const questions: JevQuestions = { ...questionEditor.policy.questions }
    if (questionEditor.originalId) delete questions[questionEditor.originalId]
    const [entry] = Object.entries(questionsFromDrafts([draft]))
    questions[entry[0]] = entry[1]
    await data.updatePolicy(questionEditor.policy.id, { questions })
    setQuestionEditor(null)
  }
  const deleteQuestion = async () => {
    if (!questionEditor?.originalId) return
    const questions: JevQuestions = { ...questionEditor.policy.questions }
    delete questions[questionEditor.originalId]
    await data.updatePolicy(questionEditor.policy.id, { questions })
    setQuestionEditor(null)
  }

  const toggleQuestion = (id: string) => setVisibleQuestionIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const selectPolicy = (id: number | null) => {
    setSelectedPolicy(id)
    setSelectedSession(sessionData.sessions.find((session) => session.primary_policy_id === id && session.project_id === project?.id)?.id ?? null)
  }
  const rail = <JevPolicyRail projects={projects} activeProjectId={project?.id ?? null} policies={policies} evaluations={evaluations} sessions={sessionData.sessions} selectedSessionId={selectedSession} selectedPolicyId={selectedPolicy} visibleQuestionIds={visibleQuestionIds} view={view} canManage={Boolean(canOperate)} onNewSetup={() => { setSelectedSession(null); setView('assistant') }} onSession={(session) => { const target = projects.find((item) => item.id === session.project_id); if (target) setActiveProject(target); setSelectedSession(session.id); setSelectedPolicy(session.primary_policy_id); setView(session.status === 'ready' && session.primary_policy_id ? 'evaluate' : 'assistant') }} onProject={(next) => { setActiveProject(next); setSelectedPolicy(null); setSelectedSession(null); setView('assistant') }} onPolicy={(policy) => { selectPolicy(policy.id); setView('evaluate') }} onView={setView} onToggleQuestion={toggleQuestion} onEditQuestion={openQuestion} onAddQuestion={addQuestion} />

  return (
    <>
      <JevWorkspaceShell compact={view === 'evaluate'} sidebar={rail} header={<WorkspaceHeader title={VIEW_TITLES[view]} project={project?.name} status={connectionStatus} loading={data.loading && data.status !== null} />}>
        {!project ? <EmptyProject /> : data.loading && !data.status ? <div role="status" className="m-auto text-sm text-muted-foreground">Loading Jev workspace…</div> : (
          <>
            {data.error && <Alert tone="error"><span>{data.error}</span><Button variant="outline" size="sm" onClick={() => void data.refresh()}>Retry</Button></Alert>}
            {sessionData.error && <Alert tone="error"><span>{sessionData.error}</span><Button variant="outline" size="sm" onClick={() => void sessionData.refresh()}>Retry chats</Button></Alert>}
            {!data.status?.configured && !data.loading && <Alert tone="warning">Jev needs a server credential. Add <code className="font-mono">TYPESAFE_API_KEY</code> to the active server configuration.</Alert>}
            {data.status?.configured && !data.status.healthy && !data.loading && <Alert tone="warning"><span>Jev could not complete its connection check. No repository content was sent.</span><Button variant="outline" size="sm" onClick={() => void data.refresh()}>Check again</Button></Alert>}
            {data.status?.cloud.state === 'configuration_error' && <Alert tone="warning">Cloud sync is misconfigured. Changes remain safely queued in Mission Control.</Alert>}
            {view === 'assistant' && data.status && !data.status.assistantAvailable && <Alert tone="warning"><span>The setup assistant connection is unavailable. Existing setups can still run with Jev.</span><Button variant="outline" size="sm" disabled={data.loading} onClick={() => void data.refresh()}>Retry assistant connection</Button></Alert>}
            {!canOperate && <div className="shrink-0 border-b border-[var(--chat-border)] px-4 py-2 text-xs text-muted-foreground">Viewer access is read-only.</div>}
            {view === 'assistant' && <JevSetupAssistant key={`${project.id}:${selectedSession ?? 'new'}`} projects={projects} activeProjectId={project.id} canOperate={Boolean(canOperate)} assistantAvailable={Boolean(data.status?.assistantAvailable)} assistantOptions={data.status?.assistantOptions} assistantDefault={data.status?.assistantDefault} sessionId={selectedSession} onSessionChange={setSelectedSession} onSessionsChanged={() => void sessionData.refresh()} onCreate={data.createPolicies} onReady={(policy) => { setSelectedPolicy(policy.id); const target = projects.find((item) => item.id === policy.project_id); if (target) setActiveProject(target); setView('evaluate') }} />}
            {view === 'evaluate' && <JevSorterWorkspace key={project.id} policies={policies} evaluations={evaluations} selectedId={selectedPolicy} visibleQuestionIds={visibleQuestionIds} canRun={Boolean(canOperate && data.status?.healthy)} canManage={Boolean(canOperate)} disabledReason={runDisabledReason} onSelect={selectPolicy} onRun={data.runEvaluation} onLoadContext={data.loadRepositoryContext} onRefresh={data.refresh} onAssistant={() => setView('assistant')} onToggleQuestion={toggleQuestion} onEditQuestion={openQuestion} onAddQuestion={addQuestion} />}
            {view === 'policies' && <PoliciesView policies={policies} canOperate={Boolean(canOperate)} editing={editing} showForm={showForm} onNew={() => { setEditing(null); setShowForm(true) }} onEdit={(policy) => { setEditing(policy); setShowForm(true) }} onSave={savePolicy} onCancel={() => { setEditing(null); setShowForm(false) }} onToggle={(policy) => data.updatePolicy(policy.id, { enabled: !policy.enabled })} onDelete={async (policy) => { if (window.confirm(`Delete “${policy.name}”? Evaluation history will be preserved.`)) await data.deletePolicy(policy.id) }} />}
            {view === 'history' && <div className="h-full overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-7xl space-y-3"><div><h2 className="text-sm font-semibold text-foreground">Evaluation history</h2><p className="text-xs text-muted-foreground">Provider version, confidence output, latency, usage, and safe error codes are retained for audit.</p></div><JevHistory evaluations={evaluations} /></div></div>}
          </>
        )}
      </JevWorkspaceShell>
      {questionEditor && <JevQuestionEditorDialog initial={questionEditor.draft} existingIds={Object.keys(questionEditor.policy.questions).filter((id) => id !== questionEditor.originalId)} canDelete={Object.keys(questionEditor.policy.questions).length > 1} onSave={saveQuestion} onDelete={questionEditor.originalId ? deleteQuestion : undefined} onClose={() => setQuestionEditor(null)} />}
    </>
  )
}

function WorkspaceHeader({ title, project, status, loading }: { title: string; project?: string; status: string; loading: boolean }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2 text-xs"><strong className="truncate text-sm text-[var(--chat-text)]">{title}</strong>{project && <span className="truncate text-[var(--chat-muted)]">· {project}</span>}<span className="ml-auto shrink-0 rounded-full border border-[var(--chat-border)] px-2 py-0.5 text-[10px] text-[var(--chat-muted)]">{loading ? 'Refreshing' : status}</span></div>
}

function EmptyProject() {
  return <div className="m-auto p-8 text-center"><p className="text-sm font-medium text-foreground">No repository projects are available</p><p className="mt-1 text-xs text-muted-foreground">Add or sync a Mission Control project before configuring Jev.</p></div>
}

function Alert({ tone, children }: { tone: 'error' | 'warning'; children: React.ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs ${tone === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>{children}</div>
}

function PoliciesView({ policies, canOperate, editing, showForm, onNew, onEdit, onSave, onCancel, onToggle, onDelete }: { policies: JevPolicy[]; canOperate: boolean; editing: JevPolicy | null; showForm: boolean; onNew: () => void; onEdit: (policy: JevPolicy) => void; onSave: (input: JevPolicyInput) => Promise<void>; onCancel: () => void; onToggle: (policy: JevPolicy) => Promise<void>; onDelete: (policy: JevPolicy) => Promise<void> }) {
  return <div className="h-full overflow-y-auto p-4 md:p-6"><section className="mx-auto max-w-7xl space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-foreground">Repository policies</h2><p className="text-xs text-muted-foreground">Noul, Choice, and Score questions may be combined in one evaluation.</p></div>{canOperate && <Button size="sm" onClick={onNew}>New policy</Button>}</div>{showForm && <JevPolicyForm policy={editing} onSubmit={onSave} onCancel={onCancel} />}<JevPolicyList policies={policies} canManage={canOperate} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} /></section></div>
}
