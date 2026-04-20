import { AtlasShell, Lane, Node, Bus, Legend } from '@/components/atlas/primitives'

export default function FullSystemView() {
  return (
    <AtlasShell
      title="01 — Full System Overview"
      subtitle="Every layer of the DarkMada at one altitude. Read top-down: human intent enters at the top, flows through the control plane, executes against the runtime, persists into the data spine, and surfaces back as audit + briefings."
    >
      <div className="space-y-6">
        <Lane label="Operator + Edge" accent="cyan">
          <Node title="Jackson" subtitle="Founder, approver, source of intent" accent="cyan" emphasis />
          <Node title="iPhone 15 Pro Max" subtitle="Telegram executive ingress" accent="cyan" />
          <Node title="Work iPhone (future)" subtitle="Carrier-isolated work line" accent="muted" />
        </Lane>

        <Bus label="Intent bus" accent="cyan" />

        <Lane label="Control Plane — DarkMada" accent="mint">
          <Node title="DarkMada UI" subtitle="The Office, Command Deck, Approvals" accent="mint" emphasis />
          <Node title="DarkMada API" subtitle="Node service — ingest + dispatch" accent="mint" />
          <Node title="Helmy" subtitle="CEO — strategy, approvals, comms" accent="cyan" />
          <Node title="Thinky" subtitle="Orchestrator — routing, budgets" accent="mint" />
        </Lane>

        <Bus label="MCP gateway" accent="violet" />

        <Lane label="Custom MCP Server Layer" accent="violet">
          <Node title="MCP Core Gateway" subtitle="Auth + tenant routing" accent="violet" />
          <Node title="Memory API" subtitle="Truth-source CRUD + retrieval" accent="violet" />
          <Node title="Context Loader" subtitle="Per-task prompt assembly" accent="violet" />
          <Node title="Event Bus" subtitle="Cross-agent pub/sub" accent="violet" />
          <Node title="Session State" subtitle="Active threads + checkpoints" accent="violet" />
          <Node title="Tool Access" subtitle="Brokered tool use w/ approvals" accent="violet" />
        </Lane>

        <Bus label="Runtime calls" accent="amber" />

        <Lane label="Runtime Agents (Node.js, SpiderMan account)" accent="amber">
          <Node title="Skywalker" subtitle="Engineering — code + ship" accent="violet" />
          <Node title="Velma" subtitle="Research — synthesis + reports" accent="amber" />
          <Node title="Dr Strange" subtitle="Memory — embeddings + mirror" accent="violet" />
          <Node title="Seccy" subtitle="Security — gates + audit" accent="crimson" />
        </Lane>

        <Bus label="Model fabric" accent="mint" />

        <Lane label="Model Fabric" accent="mint">
          <Node title="Ollama (Mainframe)" subtitle="Qwen 3.5 · GLM 4.6 · Nemotron · MiniMax 2.5" accent="mint" />
          <Node title="Anthropic" subtitle="Claude Opus 4.7 · Sonnet 4.6" accent="cyan" />
          <Node title="OpenAI" subtitle="GPT-5" accent="amber" />
        </Lane>

        <Bus label="Persistence" accent="cyan" />

        <Lane label="Data + Memory Spine" accent="cyan">
          <Node title="Supabase / Postgres" subtitle="Source of truth — memory, ideas, tasks, approvals" accent="cyan" emphasis />
          <Node title="pgvector" subtitle="Embeddings + hybrid retrieval" accent="cyan" />
          <Node title="Supabase Storage" subtitle="Artifacts, media, reports" accent="cyan" />
        </Lane>

        <Bus label="Mirror" accent="violet" />

        <Lane label="Mirror Brain + Automation" accent="amber">
          <Node title="Obsidian Vault" subtitle="Mirror only — never source of truth" accent="amber" />
          <Node title="n8n" subtitle="Schedules, webhooks, sync jobs" accent="amber" />
          <Node title="External services" subtitle="Email, calendar, GitHub, Telegram" accent="muted" />
        </Lane>

        <div className="pt-4">
          <Legend
            items={[
              { label: 'Operator', accent: 'cyan' },
              { label: 'Orchestration', accent: 'mint' },
              { label: 'MCP / Memory', accent: 'violet' },
              { label: 'Research / Auto', accent: 'amber' },
              { label: 'Security', accent: 'crimson' },
            ]}
          />
        </div>
      </div>
    </AtlasShell>
  )
}
