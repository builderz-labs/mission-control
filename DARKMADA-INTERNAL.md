# DarkMada — Internal

Jackson's modular AI operating system. One coherent internal identity: **DarkMada — Internal**.

> **For agents (OpenClaw, Helmy)**: start at [`docs/darkmada-internal/integration/openclaw-system-brief.md`](docs/darkmada-internal/integration/openclaw-system-brief.md).
> **For humans**: start at [`docs/darkmada-internal/architecture/00-overview.md`](docs/darkmada-internal/architecture/00-overview.md).
> **For visual learners**: run the app and visit [`/atlas`](http://localhost:3000/atlas).

---

## Repo layout (DarkMada surfaces)

```
src/app/atlas/                  Visual System Atlas (11 architecture views)
src/app/[[...panel]]/page.tsx   Catch-all panel router (DarkMada surfaces wired in)
src/components/darkmada/        Product surface components (The Office, Command Deck, …)
src/components/atlas/           Diagram primitives (Lane, Node, Bus, Legend)
src/lib/darkmada/               Canonical types + mock data for the surfaces
src/components/layout/nav-rail.tsx   Nav ("DARKMADA" group added)

docs/darkmada-internal/README.md         Package entry point
docs/darkmada-internal/architecture/     11-doc architecture set (00 → 10)
docs/darkmada-internal/agents/           Per-agent role docs + roster
docs/darkmada-internal/integration/      Briefs written for OpenClaw / Helmy ingest
docs/darkmada-internal/diagrams/         Pointer layer into the in-app atlas
docs/darkmada-internal/screenshots/      Rendered captures

scripts/capture-darkmada-screenshots.mjs   Playwright capture script
```

## Surfaces

| Surface | Route | Owner |
|---|---|---|
| The Office | `/dm-office` | Helmy |
| Command Deck | `/dm-deck` | Thinky |
| Org Chart | `/dm-org` | Helmy |
| Assembly Line | `/dm-assembly` | Thinky |
| The Vault | `/dm-vault` | Dr Strange |
| The Library | `/dm-library` | Dr Strange |
| The Workshop | `/dm-workshop` | Skywalker |
| Idea Forge | `/dm-forge` | Helmy |
| Intelligence Room | `/dm-intel` | Velma |
| Approvals | `/exec-approvals` | Seccy |
| System Atlas | `/atlas` | All |

## Key invariants

1. **Supabase is the only source of truth.** Obsidian is a mirror.
2. **All canonical writes go through MCP services.** No direct Postgres from agents.
3. **Approvals gate every irreversible action.** Seccy holds the signing key; Jackson signs.
4. **Three macOS accounts on the MBP** isolate concerns. Cross-account calls go through MCP over loopback.
5. **The audit log is the second source of truth** and is replicated independently.

## What's real vs placeholder

| Real today | Placeholder / planned |
|---|---|
| DarkMada UI shell + 9 product surfaces | Real Supabase wiring (mock data in `src/lib/darkmada/mock.ts`) |
| System Atlas — 11 visual architecture pages | MCP service implementations (documented + visualized) |
| Architecture + agent + integration docs | Obsidian mirror writer |
| `DARKMADA` nav group + `dm-*` routes | Mac mini host (Phase 1) |
| Screenshot capture script | Edge VPS pool (Phase 2) |

## Run

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:3000/dm-office` for The Office, or `/atlas` for the System Atlas.

## Naming rule

Only one canonical internal identity: **DarkMada — Internal**. Prior naming (Mission Control v3, Oracle
Stack v3) has been removed from this package. The underlying baseline OSS repo is `builderz-labs/mission-control`;
that remains as package origin only — never referenced as the system identity.

## Plan + history

The original transformation plan lives at [`DARKMADA-INTERNAL-PLAN.md`](DARKMADA-INTERNAL-PLAN.md).
