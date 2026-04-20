# DarkMada — Internal · Transformation Plan

**Date:** 2026-04-20
**Operator:** Jackson
**Repo baseline:** `builderz-labs/mission-control` (Next.js 16, React 19, Tailwind, Zustand, SQLite)

---

## 1. Audit Summary

**What exists that we keep:**
- Next.js 16 App Router with single dynamic catch-all route `src/app/[[...panel]]/page.tsx` that switches panels by tab id from a Zustand store (`useMissionControl`).
- Strong nav rail (`src/components/layout/nav-rail.tsx`) with grouped sections (CORE / OBSERVE / AUTOMATE / ADMIN).
- Comprehensive panel library under `src/components/panels/` (agents, tasks, memory, cron, audit, approvals, office, etc.).
- Dark-first theming via `next-themes` (default theme `void`) + Tailwind CSS variable system + `themes.ts` registry.
- Existing docs folder with screenshots, plans, releases.

**What we extend, not rewrite:**
- Keep the panel-switching shell. Add a new nav group `DARKMADA` that mounts new panels for the v3 product surfaces.
- Keep the existing themes; ensure new components use the same CSS variables for surface/border/foreground so they work across themes.

**What's new:**
- `src/app/atlas/` — a real Next.js route (not a panel) for the System Atlas / visual architecture guide. Static, server-rendered, polished. Multiple sub-pages.
- `src/components/darkmada/` — new component family for the DarkMada product surfaces.
- `src/components/atlas/` — diagram primitives (SVG nodes, lanes, connectors) and per-view diagrams.
- `src/lib/darkmada/` — mock data + canonical type definitions for the DarkMada architecture.
- `docs/architecture/`, `docs/agents/`, `docs/integration/`, `docs/runtime/`, `docs/network/`, `docs/system/`, `docs/screenshots/` — written architecture & integration knowledge.

---

## 2. Deliverable Map

### A. DarkMada product shell (panels + atlas pages)

| Surface | Implementation | Notes |
|---|---|---|
| The Office | `src/components/darkmada/office.tsx` panel | Operator's daily HUD — Helmy briefing, Thinky queue, today's lanes |
| Command Deck | `src/components/darkmada/command-deck.tsx` panel | Real-time agent status, fleet health, model fabric load |
| Org Chart | `src/components/darkmada/org-chart.tsx` panel | Visual hierarchy of named agents |
| Assembly Line | `src/components/darkmada/assembly-line.tsx` panel | Workflow lanes — n8n + Thinky pipelines |
| The Vault | `src/components/darkmada/vault.tsx` panel | Source-of-truth registry (Supabase tables, secrets boundaries) |
| The Library | `src/components/darkmada/library.tsx` panel | Mirror brain — Obsidian vault structure |
| The Workshop | `src/components/darkmada/workshop.tsx` panel | Build surface — skills, MCP servers, prompts, tools |
| Idea Forge | `src/components/darkmada/idea-forge.tsx` panel | Capture → triage → spec |
| Intelligence Room | `src/components/darkmada/intelligence-room.tsx` panel | Research lane — Velma's outputs |
| Approvals | reuses `exec-approval-panel.tsx` (already strong) | Linked from DarkMada nav |
| Settings | reuses existing `settings-panel.tsx` | |
| **System Atlas** | `src/app/atlas/` route (new) | Multi-page visual architecture guide |

### B. Architecture documentation

- `docs/architecture/00-overview.md` — full system overview
- `docs/architecture/01-mission-control.md` — DarkMada role
- `docs/architecture/02-mcp-layer.md` — custom MCP server layer
- `docs/architecture/03-data-memory-spine.md` — Supabase + pgvector
- `docs/architecture/04-runtime.md` — Node.js runtime + agent processes
- `docs/architecture/05-model-fabric.md` — Ollama + OpenAI + Anthropic routing
- `docs/architecture/06-automation.md` — n8n role
- `docs/architecture/07-mirror-brain.md` — Obsidian
- `docs/architecture/08-machines-accounts.md` — MBP / Mac mini / accounts
- `docs/architecture/09-network-security.md` — VLAN / WireGuard / Starlink
- `docs/architecture/10-future-scale.md` — modular expansion path

### C. Agent docs

- `docs/agents/helmy.md`, `thinky.md`, `skywalker.md`, `velma.md`, `dr-strange.md`, `seccy.md`
- `docs/agents/_roster.md` — canonical roster index

### D. OpenClaw / Helmy integration

- `docs/integration/openclaw-system-brief.md` — how OpenClaw should read the system
- `docs/integration/helmy-executive-role.md`
- `docs/integration/thinky-execution-role.md`
- `docs/integration/source-of-truth-rules.md`
- `docs/integration/account-boundaries.md`
- `docs/integration/mcp-role.md`
- `docs/integration/README.md` — index

### E. Visual system atlas (in-app, polished)

`src/app/atlas/` with sub-routes:
- `/atlas` — overview index linking to all views
- `/atlas/system` — full system overview diagram
- `/atlas/execution` — execution flow
- `/atlas/memory` — memory + data flow
- `/atlas/org` — agent org chart
- `/atlas/mcp` — MCP architecture
- `/atlas/runtime` — runtime + model routing
- `/atlas/compute` — machine + account boundaries
- `/atlas/network` — network + security topology
- `/atlas/scale` — future modular expansion
- `/atlas/ui-map` — DarkMada UI page map

All diagrams are **hand-built SVG** with bus/perimeter routing, no spaghetti, dark-first.

### F. Screenshots

`docs/darkmada-internal/screenshots/` — markdown stub with capture instructions + a Playwright script (`scripts/capture-darkmada-screenshots.mjs`) that runs against `pnpm dev`.

---

## 3. Execution Order

1. Type definitions + mock data (`src/lib/darkmada/types.ts`, `src/lib/darkmada/mock.ts`).
2. Atlas route + diagram primitives + 11 atlas pages.
3. DarkMada panels (10 panels).
4. Wire panels into nav-rail under new `DARKMADA` group + register in `[[...panel]]/page.tsx`.
5. Architecture + agent + integration docs.
6. Screenshot script + README.
7. Final summary.

## 4. Non-Goals

- Real Supabase wiring (mock data is fine for v1).
- Real MCP server implementation (documented + visualized only).
- Replacing existing dashboard/agents/tasks panels (they're useful — DarkMada lives alongside).

---

End of plan — executing now.
