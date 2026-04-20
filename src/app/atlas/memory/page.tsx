import { AtlasShell, Lane, Node } from '@/components/atlas/primitives'
import { VAULT_TABLES } from '@/lib/darkmada/mock'

export default function MemoryView() {
  return (
    <AtlasShell
      title="03 — Memory + Data Flow"
      subtitle="Supabase is the only source of truth. Obsidian is a mirror. Embeddings live in pgvector and are rebuilt nightly by Dr Strange."
    >
      <div className="space-y-8">
        <Lane label="Truth Source — Supabase / Postgres" accent="cyan">
          {VAULT_TABLES.map((t) => (
            <Node
              key={t.name}
              title={t.name}
              subtitle={t.purpose}
              meta={`${t.vectorized ? 'pgvector' : 'relational'}${t.truthSource ? ' · canonical' : ''}`}
              accent="cyan"
            />
          ))}
        </Lane>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card/60 p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-violet">Write path</div>
            <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
              <li>Agent emits an event via MCP Event Bus.</li>
              <li>Memory API normalizes + writes to the relevant table.</li>
              <li>Dr Strange schedules embedding for vectorized tables.</li>
              <li>Audit log records the actor, model, and cost.</li>
            </ol>
          </div>
          <div className="rounded-lg border border-border bg-card/60 p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-cyan">Read path</div>
            <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
              <li>Agent calls Retrieval Layer with query + scope.</li>
              <li>Hybrid search: vector + keyword + recency boost.</li>
              <li>Context Loader assembles prompt with citations.</li>
              <li>Cited memory ids written into the run record.</li>
            </ol>
          </div>
          <div className="rounded-lg border border-border bg-card/60 p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-amber">Mirror path (Obsidian)</div>
            <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
              <li>Nightly roundup picks salient docs.</li>
              <li>Renders to readable markdown with frontmatter.</li>
              <li>Writes into the Obsidian vault — mirror only.</li>
              <li>Edits in Obsidian never flow back automatically.</li>
            </ol>
          </div>
        </div>

        <div className="rounded-lg border border-void-crimson/20 bg-void-crimson/[0.04] p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-void-crimson">Invariant</div>
          <p className="text-sm text-foreground/90 mt-2 leading-relaxed">
            Obsidian is <strong>never</strong> the source of truth. If a fact disagrees between Supabase and
            Obsidian, Supabase wins and the next mirror cycle overwrites the file. Agents that read from Obsidian
            must mark the read as <code className="text-void-crimson">mirror</code> in their run metadata.
          </p>
        </div>
      </div>
    </AtlasShell>
  )
}
