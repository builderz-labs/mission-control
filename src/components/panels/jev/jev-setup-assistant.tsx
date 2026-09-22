'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { jevQuestionsSchema } from '@/lib/jev-validation'
import type { JevAssistantOption, JevAssistantProviderKind } from '@/lib/jev-assistant-config'
import type { JevSetupMessage, JevSetupRevision, JevSetupSession } from '@/lib/jev-setup-session-types'
import type { Project } from '@/store'
import { JevAssistantHome } from './jev-assistant-home'
import { JevAssistantConnection } from './jev-assistant-connection'
import { JevClarificationCard } from './jev-clarification-card'
import { JevFlowSteps } from './jev-flow-steps'
import { JevRepositoryScope } from './jev-repository-scope'
import { JevSetupReview } from './jev-setup-review'
import { recommendedAnswers, setupQuestions, type SetupQuestion } from './jev-setup-options'
import type { JevAssistantResponse, JevPolicy, JevPolicyInput } from './jev-ui-types'
import { idsForScope, latestStoredInput, revisionResponse } from './jev-setup-state'

export function JevSetupAssistant({
  projects, activeProjectId, canOperate, assistantAvailable, assistantOptions, assistantDefault = 'claude-cli', sessionId,
  onSessionChange, onSessionsChanged, onCreate, onReady,
}: {
  projects: Project[]
  activeProjectId: number | null
  canOperate: boolean
  assistantAvailable: boolean
  assistantOptions?: JevAssistantOption[]
  assistantDefault?: JevAssistantProviderKind
  sessionId: string | null
  onSessionChange: (id: string | null) => void
  onSessionsChanged: () => void
  onCreate: (input: JevPolicyInput, projectIds: number[], approval?: {
    sessionId: string; expectedRevisionNo: number
  }) => Promise<JevPolicy[]>
  onReady: (policy: JevPolicy) => void
}) {
  const [stage, setStage] = useState<'describe' | 'clarify' | 'review' | 'saved'>('describe')
  const [hasClarified, setHasClarified] = useState(false)
  const [provider, setProvider] = useState(assistantDefault)
  const providers = assistantOptions ?? [{ kind: 'claude-cli' as const, label: 'Claude Code', model: 'haiku', configured: assistantAvailable }]
  const selectedProvider = providers.find((option) => option.kind === provider)
  const [goal, setGoal] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [selectedIds, setSelectedIds] = useState<number[]>(activeProjectId ? [activeProjectId] : [])
  const [lockedIds, setLockedIds] = useState<number[]>([])
  const [dynamicQuestions, setDynamicQuestions] = useState<SetupQuestion[]>([])
  const [response, setResponse] = useState<JevAssistantResponse | null>(null)
  const [schemaText, setSchemaText] = useState('')
  const [revisionNo, setRevisionNo] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingSession, setLoadingSession] = useState(Boolean(sessionId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const draftSessionRef = useRef(sessionId)
  const requestRef = useRef(0)
  const targetIds = useMemo(() => idsForScope(
    answers.scope, projects, activeProjectId, selectedIds,
  ), [activeProjectId, answers.scope, projects, selectedIds])
  const activeQuestions = dynamicQuestions.length > 0 ? dynamicQuestions : setupQuestions
  useEffect(() => () => { requestRef.current++; abortRef.current?.abort() }, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    abortRef.current?.abort()
    if (!sessionId) {
      setBusy(false); setLoadingSession(false); draftSessionRef.current = null
      setStage('describe'); setHasClarified(false); setGoal(''); setAnswers({}); setResponse(null); setSchemaText(''); setRevisionNo(null)
      setLockedIds([]); setDynamicQuestions([])
      setSelectedIds(activeProjectId ? [activeProjectId] : []); setError(null)
      return
    }
    setBusy(true); setLoadingSession(true); setError(null)
    Promise.all([
      apiFetch<{ session: JevSetupSession; latestRevision: JevSetupRevision | null }>(`/api/jev/sessions/${sessionId}`),
      apiFetch<{ messages: JevSetupMessage[] }>(`/api/jev/sessions/${sessionId}/messages?limit=200`),
    ]).then(([detail, history]) => {
      if (requestId !== requestRef.current) return
      const input = latestStoredInput(history.messages)
      setProvider(detail.session.provider === 'openai' || detail.session.provider === 'anthropic' ? detail.session.provider : 'claude-cli')
      setGoal(input.goal ?? detail.session.title); setAnswers(input.answers ?? {})
      setLockedIds(input.projectIds ?? [detail.session.project_id])
      setSelectedIds(input.projectIds ?? [detail.session.project_id])
      if (!detail.latestRevision) { setStage('describe'); return }
      const restored = revisionResponse(detail.latestRevision)
      setProvider(restored.provider.kind)
      setRevisionNo(detail.latestRevision.revision_no)
      setResponse(restored); setSchemaText(JSON.stringify(restored.draft.questions, null, 2))
      setDynamicQuestions(restored.draft.clarifications ?? []); setStep(0)
      setHasClarified(Boolean(restored.draft.clarifications?.length))
      setStage(restored.draft.clarifications?.length ? 'clarify' : 'review')
    }).catch((cause: unknown) => {
      if (requestId === requestRef.current) setError(cause instanceof Error ? cause.message : 'Unable to load setup chat')
    }).finally(() => { if (requestId === requestRef.current) { setBusy(false); setLoadingSession(false) } })
  }, [activeProjectId, sessionId])

  const requestDraft = async (nextAnswers: Record<string, string>, revision?: string) => {
    if (!canOperate) return
    abortRef.current?.abort()
    const requestId = ++requestRef.current
    const controller = new AbortController()
    setBusy(true); setError(null); abortRef.current = controller
    let activeSessionId = sessionId ?? draftSessionRef.current
    try {
      if (!activeProjectId) throw new Error('Choose a repository first')
      const ids = lockedIds.length ? lockedIds : idsForScope(nextAnswers.scope, projects, activeProjectId, selectedIds)
      if (!activeSessionId) {
        const created = await apiFetch<{ session: JevSetupSession }>('/api/jev/sessions', {
          method: 'POST', signal: controller.signal, body: JSON.stringify({
            projectId: activeProjectId, title: goal.trim().slice(0, 120), provider, model: selectedProvider?.model ?? 'haiku',
            initialInput: { goal, answers: nextAnswers, projectIds: ids },
          }),
        })
        activeSessionId = created.session.id
        draftSessionRef.current = activeSessionId
      }
      const next = await apiFetch<JevAssistantResponse>('/api/jev/assistant', {
        method: 'POST', timeoutMs: 140_000, signal: controller.signal, body: JSON.stringify({
          sessionId: activeSessionId, action: revision ? 'revise' : 'draft', goal, provider,
          answers: nextAnswers, projectIds: ids,
          currentDraft: revision && response ? { ...response.draft, questions: jevQuestionsSchema.parse(JSON.parse(schemaText)) } : undefined, revision,
        }),
      })
      if (requestId !== requestRef.current) return
      setLockedIds(ids); setResponse(next); setSchemaText(JSON.stringify(next.draft.questions, null, 2))
      setRevisionNo(next.session?.revisionNo ?? null)
      if ((next.draft.clarifications?.length ?? 0) > 0) {
        setDynamicQuestions(next.draft.clarifications ?? []); setStep(0); setHasClarified(true); setStage('clarify')
      } else { setDynamicQuestions([]); setStage('review') }
      onSessionChange(activeSessionId); onSessionsChanged()
    } catch (cause) {
      if (controller.signal.aborted) return
      if (requestId === requestRef.current) setError(cause instanceof Error ? cause.message : 'Unable to draft the setup')
    } finally {
      if (requestId === requestRef.current) { setBusy(false); abortRef.current = null; onSessionsChanged() }
    }
  }

  const answer = (value: string) => {
    if (busy) return
    const next = { ...answers, [activeQuestions[step].id]: value }
    setAnswers(next)
    if (step === activeQuestions.length - 1) {
      void requestDraft(next, dynamicQuestions.length > 0
        ? 'Revise the draft using these explicit clarification answers.' : undefined)
    }
    else setStep((current) => current + 1)
  }

  const skipRest = () => {
    const remaining = Object.fromEntries(activeQuestions.slice(step).map((entry) => [
      entry.id, entry.options.find((option) => option.recommended)?.value ?? entry.options[0].value,
    ]))
    const next = { ...answers, ...remaining }
    setAnswers(next)
    void requestDraft(next, dynamicQuestions.length > 0 ? 'Revise the draft using these explicit clarification answers.' : undefined)
  }

  const save = async () => {
    if (!response || !canOperate || response.draft.clarifications?.length) return
    setSaving(true); setError(null)
    try {
      const questions = jevQuestionsSchema.parse(JSON.parse(schemaText))
      const ids = lockedIds.length ? lockedIds : targetIds
      if (ids.length === 0) throw new Error('Choose at least one repository to store this policy')
      const input = {
        name: response.draft.name, description: response.draft.description,
        model: 'jev-latest', mode: response.configuration.rollout === 'shadow' ? 'shadow' : 'manual',
        questions, configuration: { ...response.configuration, projectIds: ids }, enabled: true,
      } satisfies JevPolicyInput
      const approved = sessionId && revisionNo
        ? { sessionId, expectedRevisionNo: revisionNo } : undefined
      const policies = approved ? await onCreate(input, ids, approved) : await onCreate(input, ids)
      if (!policies[0]) throw new Error('No policy was returned after saving')
      if (sessionId && !approved) await apiFetch(`/api/jev/sessions/${sessionId}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'ready', primaryPolicyId: policies[0].id }),
      })
      setStage('saved'); onSessionsChanged(); onReady(policies[0])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the policy') }
    finally { setSaving(false) }
  }

  if (loadingSession) return <div role="status" className="m-auto p-6 text-sm text-muted-foreground">Opening your saved setup chat…</div>
  if (stage === 'saved') return <div role="status" className="m-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6"><h2 className="text-lg font-semibold text-foreground">Policy ready</h2><p className="mt-1 text-sm text-muted-foreground">Review the outbound context in Evaluate, then run a safe sample with Jev.</p></div>
  if (stage === 'review' && response) return <div className="h-full overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-5xl"><JevFlowSteps current="review" skipped={hasClarified ? [] : ['clarify']} /><JevAssistantConnection compact options={providers} selected={provider} disabled={busy || saving || !canOperate} onChange={setProvider} /><JevSetupReview response={response} schemaText={schemaText} saving={saving} revising={busy} readOnly={!canOperate} error={error} onSchemaChange={setSchemaText} onDraftChange={(key, value) => setResponse((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current)} onRevise={(revision) => void requestDraft(answers, revision)} onSave={() => void save()} onBack={() => { setStep(0); setStage('clarify') }} /></div></div>
  if (stage === 'clarify') return <div className="h-full overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-4xl"><JevFlowSteps current="clarify" /><div className="space-y-3">{answers.scope === 'selected' && <JevRepositoryScope projects={projects} selected={selectedIds} onChange={setSelectedIds} />}<p aria-live="polite" className="text-xs text-muted-foreground">Question {step + 1} of {activeQuestions.length}</p><JevClarificationCard key={activeQuestions[step].id} question={activeQuestions[step]} value={answers[activeQuestions[step].id]} disabled={busy} onAnswer={answer} onBack={() => step === 0 ? setStage(dynamicQuestions.length > 0 ? 'review' : 'describe') : setStep((current) => current - 1)} onSkipRest={step < activeQuestions.length - 1 ? skipRest : undefined} />{busy && <div role="status" className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"><span>The setup assistant is drafting a validated policy…</span><Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button></div>}{error && <p role="alert" className="text-sm text-red-300">{error}</p>}</div></div></div>
  return <JevAssistantHome goal={goal} busy={busy} canOperate={canOperate} assistantAvailable={Boolean(selectedProvider?.configured)} providers={providers} provider={provider} onProvider={setProvider} error={error} onGoal={setGoal} onRecommended={() => { const next = { ...recommendedAnswers, ...answers }; setAnswers(next); void requestDraft(next) }} onCustomize={() => { setDynamicQuestions([]); setStep(0); setHasClarified(true); setStage('clarify') }} onCancel={() => abortRef.current?.abort()} />
}
