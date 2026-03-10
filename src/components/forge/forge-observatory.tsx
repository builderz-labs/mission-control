import Link from 'next/link'
import type { ForgePlatformData } from '@/lib/forge/types'

export function ForgeObservatory({ data }: { data: ForgePlatformData }) {
  const completeDocSets = [data.rootDocs, ...data.modules.map((module) => module.docs)].filter((doc) => doc.complete).length
  const totalDocSets = 1 + data.modules.length

  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <section className="rounded-3xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,_rgba(6,182,212,0.2),_transparent_30%),linear-gradient(160deg,_rgba(7,17,31,0.98),_rgba(15,23,42,0.96))] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Marcuzx Forge Observatory</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Platform Readiness View</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                This route summarizes how ready the Marcuzx Forge MVP is to operate: documented modules, active source projects,
                memory coverage, agent-role availability, and the remaining open work captured in checklist backlogs.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/forge" className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300">
                Open Control Center
              </Link>
              <Link href="/" className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">
                Mission Control
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Doc Sets Complete" value={`${completeDocSets}/${totalDocSets}`} tone="cyan" />
          <MetricCard label="Open Work Items" value={String(data.totalOpenTasks)} tone="amber" />
          <MetricCard label="Registered Projects" value={String(data.projects.length)} tone="emerald" />
          <MetricCard label="Agent Specs" value={String(data.agents.length)} tone="violet" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-xl font-semibold text-white">Documentation Readiness</h2>
            <p className="mt-1 text-sm text-slate-400">Every initialized module now carries the standard Marcuzx Forge docs contract.</p>
            <div className="mt-5 grid gap-3">
              {[data.rootDocs, ...data.modules.map((module) => module.docs)].map((doc) => (
                <article key={doc.path} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{doc.label}</h3>
                      <p className="text-xs text-slate-500">{doc.path}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${doc.complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {doc.complete ? 'Complete' : `${doc.missing.length} missing`}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span>{doc.present.length} present</span>
                    <span>{doc.checklist.done} done</span>
                    <span>{doc.checklist.open} open</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-xl font-semibold text-white">Memory Coverage</h2>
              <p className="mt-1 text-sm text-slate-400">File-based learning assets available to future agents.</p>
              <div className="mt-4 grid gap-2">
                {data.memoryAssets.map((asset) => (
                  <div key={asset} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    {asset}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-xl font-semibold text-white">Open Work Queue</h2>
              <p className="mt-1 text-sm text-slate-400">Checklist backlog extracted from the standardized task docs.</p>
              <div className="mt-4 grid gap-3">
                {[data.rootDocs, ...data.modules.map((module) => module.docs)]
                  .filter((doc) => doc.checklist.open > 0)
                  .map((doc) => (
                    <div key={doc.path} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">{doc.label}</span>
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-300">{doc.checklist.open} open</span>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-xl font-semibold text-white">Project Readiness Matrix</h2>
          <p className="mt-1 text-sm text-slate-400">Workspace projects currently mapped into the Marcuzx Forge ecosystem.</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {data.projects.map((project) => (
              <article key={project.repoName} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-white">{project.projectName}</h3>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{project.status}</span>
                </div>
                <p className="mt-3 text-sm text-slate-300">{project.description}</p>
                <dl className="mt-4 space-y-2 text-sm text-slate-400">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Path</dt>
                    <dd>{project.path}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Maturity</dt>
                    <dd>{project.architectureMaturity}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Last Focus</dt>
                    <dd>{project.lastKnownFocus}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'amber' | 'emerald' | 'violet' }) {
  const toneMap = {
    cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    violet: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
  }

  return (
    <article className={`rounded-3xl border p-5 ${toneMap[tone]}`}>
      <p className="text-xs uppercase tracking-[0.25em] opacity-80">{label}</p>
      <p className="mt-3 text-4xl font-semibold text-white">{value}</p>
    </article>
  )
}
