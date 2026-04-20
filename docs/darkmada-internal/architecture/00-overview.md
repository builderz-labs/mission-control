# 00 — DarkMada: System Overview

**Status:** Canonical
**Owner:** Jackson
**Last reviewed:** 2026-04-20

---

## What this is

The DarkMada is the codename for Jackson's modular AI operating system. It is a layered stack with one
operator (Jackson), one control plane (DarkMada), a small roster of named agents, a custom MCP layer,
a Postgres-backed memory spine, a model fabric that blends local and cloud inference, and a documented future
path toward an always-on home server.

DarkMada is the **master system** — every other surface either feeds into it (via webhooks, Telegram,
events) or is operated through it.

---

## Layered view (top → bottom)

| Layer | Components | Purpose |
|---|---|---|
| Operator + edge | Jackson, iPhone 15 Pro Max, future work iPhone | Intent capture; approvals |
| Control plane | DarkMada UI + API; Helmy; Thinky | Translates intent into runs; surfaces system state |
| MCP server layer | Core Gateway, Memory API, Context Loader, Event Bus, Retrieval, Session State, Agent Context, Tool Access | Sole sanctioned channel between agents and the spine |
| Runtime agents | Skywalker, Velma, Dr Strange, Seccy | Execute work using the model fabric and MCP services |
| Model fabric | Ollama (Mainframe account), Anthropic, OpenAI | Inference. Routed by Thinky based on task class |
| Data + memory spine | Supabase / Postgres + pgvector + Storage | The only source of truth |
| Mirror brain + automation | Obsidian (mirror), n8n (workflows) | Human-readable mirror; scheduled and event flows |
| Compute fabric | MacBook Pro 48GB (3 accounts), Mac mini (planned), edge VPS pool (planned) | Where everything runs |
| Network + security | Router + VLAN, WireGuard, Starlink (optional) | Segmented trust + secure remote access |

See `01-control-plane.md` through `10-future-scale.md` for each layer in depth.

---

## Source-of-truth rule

**Supabase / Postgres is the only source of truth.** Obsidian is a mirror. SQLite (`.data/mission-control.db`)
in this repo is a local cache and ops scratchpad — when the system reaches Phase 1, it becomes a
write-through cache against Supabase. See `docs/integration/source-of-truth-rules.md`.

---

## Naming conventions

- **Agents** are named (Helmy, Thinky, Skywalker, Velma, Dr Strange, Seccy). They are not generic roles.
- **Surfaces** in DarkMada carry product names (The Office, Command Deck, etc.) — not labels.
- **Lanes** in the Assembly Line are named workflows. Each lane has one owner agent.
- **Phases** of expansion are numbered (Phase 0 → Phase 3). See `10-future-scale.md`.

---

## How to read these docs

1. Start with this file.
2. Read `01-control-plane.md` to understand the control plane.
3. Read `02-mcp-layer.md` and `03-data-memory-spine.md` together — they explain the gates and the store.
4. Read `04-runtime.md` and `05-model-fabric.md` together — they explain how work executes.
5. Use the System Atlas in the app (`/atlas`) for the visual companion.

For agent-targeted briefs (so OpenClaw / Helmy can ingest the system), see `docs/integration/`.
