'use client'

import { useEffect, useMemo, useState } from 'react'
import { GraphCanvas, type GraphNode, type GraphEdge } from 'reagraph'
import { apiFetch } from '@/lib/api-client'

// ATHENA Content Pipeline — make.com-style flow of the whole content system.
// Steps (the flow) + Gates (what must be configured before a brand can post).
// Click any node for a plain-English explanation.

type Row = Record<string, unknown>
interface PipelineData { steps?: Row[]; gates?: Row[]; edges?: { from: string; to: string; label?: string }[] }
interface ContentResp { ok: boolean; pipeline?: PipelineData }

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

function ownerColor(owner: string): string {
  switch (owner) {
    case 'Notion': return '#cba6f7'
    case 'GitHub': return '#89b4fa'
    case 'External Tool': return '#a6e3a1'
    case 'Device Runtime': return '#fab387'
    default: return '#94a3b8'
  }
}

export function ContentPipelinePanel() {
  const [pipeline, setPipeline] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<ContentResp>('/api/content')
      .then(d => setPipeline(d.pipeline ?? { steps: [], gates: [], edges: [] }))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Failed to load pipeline'))
      .finally(() => setLoading(false))
  }, [])

  const steps = pipeline?.steps ?? []
  const gates = pipeline?.gates ?? []
  const edges = pipeline?.edges ?? []

  const nodes: GraphNode[] = useMemo(() => [
    ...steps.map(st => ({ id: s(st.id), label: `${s(st.order)}. ${s(st.name)}`, fill: ownerColor(s(st.owner)), data: { kind: 'step' } })),
    ...gates.map(g => ({ id: s(g.id), label: `⛔ ${s(g.name)}`, fill: '#f59e0b', data: { kind: 'gate' } })),
  ], [steps, gates])

  const graphEdges: GraphEdge[] = useMemo(() => [
    ...edges.map((e, i) => ({ id: `flow-${i}`, source: e.from, target: e.to, label: e.label })),
    ...gates.map((g, i) => ({ id: `gate-${i}`, source: s(g.attachesTo), target: s(g.id), label: 'gate' })),
  ], [edges, gates])

  const selected = useMemo(() => {
    if (!selectedId) return null
    return steps.find(x => s(x.id) === selectedId) || gates.find(x => s(x.id) === selectedId) || null
  }, [selectedId, steps, gates])
  const selectedIsGate = useMemo(() => !!selected && gates.some(g => s(g.id) === s(selected.id)), [selected, gates])

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading pipeline…</div>
  if (err) return <div className="p-8 text-sm text-red-400">Could not load pipeline: {err}</div>
  if (!steps.length) return <div className="p-8 text-sm text-muted-foreground">No pipeline data. Run content-system/sync.mjs / check the mirror.</div>

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">🔀 Content Pipeline</h1>
        <p className="text-xs text-muted-foreground">The whole content system as a flow. Blue→ steps run left to right; ⛔ amber gates must be configured before a brand can post. Click any node for details.</p>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: '#cba6f7' }} />Notion</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: '#89b4fa' }} />GitHub</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: '#a6e3a1' }} />External</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: '#fab387' }} />Device</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: '#f59e0b' }} />Gate</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <div className="relative rounded-lg border border-border bg-card overflow-hidden" style={{ height: '68vh' }}>
          <GraphCanvas
            nodes={nodes}
            edges={graphEdges}
            layoutType="hierarchicalLr"
            labelType="all"
            edgeArrowPosition="end"
            onNodeClick={(node) => setSelectedId(node.id)}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4 max-h-[68vh] overflow-y-auto">
          {selected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${selectedIsGate ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>{selectedIsGate ? 'GATE' : `STEP ${s(selected.order)}`}</span>
                <span className="text-[11px] text-muted-foreground">{s(selected.owner)}</span>
              </div>
              <div className="text-base font-semibold text-foreground">{s(selected.name)}</div>
              <p className="text-sm text-foreground/90">{s(selected.plainEnglish)}</p>
              {s(selected.requiredConfig) && (<div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">Required config</div><div className="text-sm text-foreground">{s(selected.requiredConfig)}</div></div>)}
              {selectedIsGate && s(selected.blocksPostingUntil) && (<div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">Blocks posting until</div><div className="text-sm text-foreground">{s(selected.blocksPostingUntil)}</div></div>)}
              {selectedIsGate && s(selected.reviewQuestion) && (<div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">Review question</div><div className="text-sm italic text-foreground">“{s(selected.reviewQuestion)}”</div></div>)}
              {s(selected.targetDatabase) && (<div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">Lives in</div><div className="text-sm text-foreground">{s(selected.targetDatabase)}</div></div>)}
              {s(selected.next) && (<div><div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">Next</div><div className="text-sm text-foreground">{s(selected.next)}</div></div>)}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              <p className="text-foreground font-medium mb-1">The content pipeline</p>
              <p>Click any node to see what it does, what it needs, and (for gates) what it blocks until configured.</p>
              <ul className="mt-3 space-y-1 text-xs">
                {steps.map(st => (
                  <li key={s(st.id)}><button className="text-left hover:text-foreground" onClick={() => setSelectedId(s(st.id))}><b className="text-foreground">{s(st.order)}.</b> {s(st.name)}</button></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
