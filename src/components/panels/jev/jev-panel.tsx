'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { JevHistory } from './jev-history'
import { JevPolicyForm } from './jev-policy-form'
import { JevPolicyList } from './jev-policy-list'
import { JevQuickstart } from './jev-quickstart'
import { JevWorkbench } from './jev-workbench'
import type { JevPolicy, JevPolicyInput } from './jev-ui-types'
import { useJevDashboard } from './use-jev-dashboard'

type Tab = 'workbench' | 'policies' | 'history'
const field = 'rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-void-cyan'

export function JevPanel() {
  const { projects, activeProject, setActiveProject, fetchProjects, currentUser } = useMissionControl()
  const [tab, setTab] = useState<Tab>('workbench')
  const [editing, setEditing] = useState<JevPolicy | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [selectedPolicy, setSelectedPolicy] = useState<number | null>(null)
  const project = useMemo(() => projects.find((item) => item.id === activeProject?.id) ?? projects[0] ?? null, [activeProject, projects])
  const data = useJevDashboard(project?.id ?? null)
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'
  const runDisabledReason = !canOperate
    ? 'Operator access is required to send an evaluation.'
    : !data.status?.configured ? 'Connect the TypeSafe credential before evaluating.' : undefined

  useEffect(() => { if (projects.length === 0) void fetchProjects() }, [fetchProjects, projects.length])
  useEffect(() => { if (project && activeProject?.id !== project.id) setActiveProject(project) }, [activeProject?.id, project, setActiveProject])
  useEffect(() => {
    if (selectedPolicy && !data.policies.some((policy) => policy.id === selectedPolicy && policy.enabled)) setSelectedPolicy(null)
  }, [data.policies, selectedPolicy])

  const savePolicy = async (input: JevPolicyInput) => {
    if (editing) await data.updatePolicy(editing.id, input)
    else await data.createPolicy(input)
    setEditing(null)
    setShowForm(false)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold text-foreground">Jev by TypeSafe</h1><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${data.status?.configured ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'}`}>{data.status?.configured ? 'Connected' : 'Not configured'}</span></div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Ask repeatable questions about any repository and get probability-based answers with a complete audit trail. Jev never changes code or makes the decision for you.</p></div>
        <label className="flex min-w-64 flex-col text-xs text-muted-foreground">Repository<select className={`${field} mt-1`} value={project?.id ?? ''} onChange={(event) => setActiveProject(projects.find((item) => item.id === Number(event.target.value)) ?? null)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.github_repo ? ` · ${item.github_repo}` : ''}</option>)}</select></label>
      </header>

      {data.error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><span>{data.error}</span><Button variant="outline" size="sm" onClick={() => void data.refresh()}>Retry</Button></div>}
      {!data.status?.configured && !data.loading && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"><strong>Jev needs a server credential.</strong> Add <code className="font-mono">TYPESAFE_API_KEY</code> to the active Doppler production configuration. The key is never sent to the browser.</div>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Jev status summary">
        <Metric label="Workspace policies" value={data.status?.policyCount ?? 0} />
        <Metric label="Workspace evaluations" value={data.status?.evaluationCount ?? 0} />
        <Metric label="Successful runs" value={data.status?.successfulCount ?? 0} />
        <Metric label="Default model" value={data.status?.defaultModel ?? 'jev-latest'} mono />
      </section>

      {!project ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center"><p className="text-sm font-medium text-foreground">No repository projects are available</p><p className="mt-1 text-xs text-muted-foreground">Add or sync a Mission Control project before configuring Jev.</p></div>
      ) : data.loading ? (
        <div role="status" aria-live="polite" className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading Jev workspace…</div>
      ) : (
        <>
          <details className="rounded-lg border border-border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">New to Jev? Learn the three answer types</summary>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><p><strong className="text-foreground">Yes / no (Noul)</strong><br />A probability between no and yes.</p><p><strong className="text-foreground">Choose one (Choice)</strong><br />Probabilities across your named options.</p><p><strong className="text-foreground">Rating (Score)</strong><br />A weighted position across 2–10 levels.</p></div>
          </details>
          {data.policies.length === 0 && <JevQuickstart canCreate={Boolean(canOperate)} onCreate={data.createPolicy} onReady={(policy) => { setSelectedPolicy(policy.id); setTab('workbench') }} />}
          <nav aria-label="Jev sections" className="flex gap-1 rounded-lg border border-border bg-card p-1">{(['workbench', 'policies', 'history'] as Tab[]).map((item) => <Button key={item} variant={tab === item ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(item)} className="capitalize">{item}</Button>)}</nav>
          {!canOperate && <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">Viewer access is read-only. An operator or administrator can create policies and run evaluations.</div>}
          {tab === 'workbench' && <JevWorkbench key={project.id} policies={data.policies} selectedId={selectedPolicy} canRun={Boolean(canOperate && data.status?.configured)} disabledReason={runDisabledReason} onSelect={setSelectedPolicy} onRun={data.runEvaluation} onLoadContext={data.loadRepositoryContext} />}
          {tab === 'policies' && <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-foreground">Repository policies</h2><p className="text-xs text-muted-foreground">Noul, Choice, and Score questions may be combined in one evaluation.</p></div>{canOperate && <Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}>New policy</Button>}</div>{showForm && <JevPolicyForm policy={editing} onSubmit={savePolicy} onCancel={() => { setShowForm(false); setEditing(null) }} />}<JevPolicyList policies={data.policies} canManage={canOperate} onEdit={(policy) => { setEditing(policy); setShowForm(true) }} onToggle={(policy) => data.updatePolicy(policy.id, { enabled: !policy.enabled })} onDelete={async (policy) => { if (window.confirm(`Delete “${policy.name}”? Evaluation history will be preserved.`)) await data.deletePolicy(policy.id) }} /></section>}
          {tab === 'history' && <section className="space-y-3"><div><h2 className="text-sm font-semibold text-foreground">Evaluation history</h2><p className="text-xs text-muted-foreground">Provider version, confidence output, latency, usage, and safe error codes are retained for audit.</p></div><JevHistory evaluations={data.evaluations} /></section>}
        </>
      )}
    </div>
  )
}

function Metric({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return <div className="rounded-lg border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-lg font-semibold text-foreground ${mono ? 'font-mono text-sm' : ''}`}>{value}</div></div>
}
