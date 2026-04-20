# 01 — Control Plane (DarkMada)

DarkMada is the **master system** — the operator's command plane and the front door to every other
component of the DarkMada.

## Responsibilities

- Render every operator surface (The Office, Command Deck, Org Chart, Assembly Line, The Vault, The Library,
  The Workshop, Idea Forge, Intelligence Room, Approvals, Settings, System Atlas).
- Hold the live view of agent state, queued work, and pending approvals.
- Provide the only UI through which Jackson approves irreversible actions.
- Host the System Atlas — architecture-as-product.

## Components

| Component | Where it lives | What it does |
|---|---|---|
| UI | `src/app/`, `src/components/` (this repo) | Next.js 16 App Router, dark-first |
| API | `src/app/api/`, Node service | REST + SSE for the UI; brokers to MCP layer |
| Plugin system | `src/lib/plugins.ts` | Lets surfaces ship as plugins (used by partner skills) |
| Atlas | `src/app/atlas/` | The visual architecture guide |
| DarkMada surfaces | `src/components/darkmada/` | The v3 surfaces (Office, Deck, Org, etc.) |

## Surfaces (v3)

| Surface | Owner | Purpose |
|---|---|---|
| The Office | Helmy | Daily briefing, priorities, what needs Jackson now |
| Command Deck | Thinky | Live agent + model fabric status |
| Org Chart | Helmy | Visual hierarchy of the agent roster |
| Assembly Line | Thinky | Workflow lanes (n8n + orchestrator) |
| The Vault | Dr Strange | Source-of-truth registry (Supabase tables) |
| The Library | Dr Strange | Mirror brain — Obsidian view (read-only) |
| The Workshop | Skywalker | Skills, MCP servers, prompts, tools |
| Idea Forge | Helmy | Capture → triage → spec → promote |
| Intelligence Room | Velma | Synthesized research with citations |
| Approvals | Seccy | Gated actions awaiting sign-off |
| Settings | Operator | Themes, integrations, model keys |
| System Atlas | All | The visual architecture guide |

## Boundary

DarkMada **never** holds secrets. It calls the MCP Tool Access service, which brokers per-call short-lived
tokens. DarkMada **never** writes directly to Supabase — every write goes through Memory API or
domain-specific MCP services. This guarantees that the audit log is always complete.
