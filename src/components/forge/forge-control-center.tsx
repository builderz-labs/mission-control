import Link from 'next/link'
import type { ForgePlatformData } from '@/lib/forge/types'

export function ForgeControlCenter({ data }: { data: ForgePlatformData }) {
  const fullyDocumentedModules = data.modules.filter((module) => module.docs.complete).length

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        <section className="overflow-hidden rounded-3xl border border-orange-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.22),_transparent_32%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.95))] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-orange-300">{data.internalIdentity}</p>
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{data.brand}</h1>
                <p className="mt-2 text-lg text-slate-300">{data.tagline}</p>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                This MVP turns the existing Mission Control repo into the first working Marcuzx Forge factory host with a control layer,
                registry, standards, agents, memory, and an observability path that can expand into multi-repo operation later.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/forge/observatory" className="rounded-full bg-orange-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-orange-400">
                Open Observatory
              </Link>
              <Link href="/" className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">
                Existing Dashboard
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Projects Registered" value={String(data.projects.length)} detail="Discovered from local workspace" />
          <MetricCard label="Modules Initialized" value={String(data.modules.length)} detail={`${fullyDocumentedModules}/${data.modules.length} fully documented`} />
          <MetricCard label="Open Work Items" value={String(data.totalOpenTasks)} detail={`${data.totalCompletedTasks} completed checklist items`} />
          <MetricCard label="Memory Assets" value={String(data.memoryAssets.length)} detail="Snapshots, decisions, patterns, summaries" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Platform Modules</h2>
                <p className="text-sm text-slate-400">Control, registry, standards, memory, observatory, and Eak AI Factory agents.</p>
              </div>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">Docs-first MVP</span>
            </div>
            <div className="grid gap-4">
              {data.modules.map((module) => (
                <article key={module.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div>
                        <h3 className="text-base font-semibold text-white">{module.name}</h3>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{module.internalIdentity}</p>
                      </div>
                      <p className="max-w-2xl text-sm text-slate-300">{module.purpose}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${module.docs.complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {module.docs.complete ? 'Docs complete' : `${module.docs.missing.length} docs missing`}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>Path: {module.path}</span>
                    <span>Route: {module.uiRoute}</span>
                    <span>Backlog: {module.docs.checklist.open} open</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <h2 className="text-xl font-semibold text-white">Repository Docs</h2>
              <p className="mt-1 text-sm text-slate-400">Standardized root documentation for discovery, architecture, operations, and change tracking.</p>
              <div className="mt-4 grid gap-2 text-sm text-slate-300">
                {data.rootDocs.present.map((file) => (
                  <div key={file} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                    <span>{file}</span>
                    <span className="text-emerald-300">Present</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <h2 className="text-xl font-semibold text-white">Agent System</h2>
              <p className="mt-1 text-sm text-slate-400">Eak AI Factory agent roles with evidence and stop-condition contracts.</p>
              <div className="mt-4 grid gap-3">
                {data.agents.map((agent) => (
                  <div key={agent.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                      <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300">specified</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{agent.role}</p>
                    <p className="mt-2 text-xs text-slate-500">{agent.path}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Project Registry</h2>
              <p className="text-sm text-slate-400">Real workspace sources currently registered in Marcuzx Forge.</p>
            </div>
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">Owner: Marcuzx Forge</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Project</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Stack</th>
                  <th className="pb-3 pr-4 font-medium">Maturity</th>
                  <th className="pb-3 font-medium">Role in Forge</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => (
                  <tr key={project.repoName} className="border-t border-slate-800 align-top">
                    <td className="py-4 pr-4">
                      <div className="font-medium text-white">{project.projectName}</div>
                      <div className="mt-1 text-xs text-slate-500">{project.path}</div>
                      <p className="mt-2 max-w-md text-sm text-slate-300">{project.description}</p>
                    </td>
                    <td className="py-4 pr-4 text-slate-300">{project.status}</td>
                    <td className="py-4 pr-4 text-slate-300">{project.stack.join(', ')}</td>
                    <td className="py-4 pr-4 text-slate-300">{project.architectureMaturity}</td>
                    <td className="py-4 text-slate-300">{project.roleInForge.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-3 text-4xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </article>
  )
}
