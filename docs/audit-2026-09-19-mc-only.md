# Mission Control audit — 2026-09-19 (repo-only)

Scope: **this repository only** (`tylerdevries22-afk/mission-control`), tip `main` @ post-promote PR #8.
Not in scope: other `~/Dev` repos, Actz-may swarm, Stillpoint Finance, etc.

## Fixed in this pass

| Item | Change |
|------|--------|
| Auth-expired UX | Added `sonner` + `AppToaster`; `AuthExpiredListener` now toasts on `mc:auth-expired` instead of console-only. |
| Dependency | `sonner` ^2.0.8 |

## Verified already landed (do not redo)

- AUD-003 / 009 / 010 / 011 / 012 / 025 (patch-id matched earlier promote cleanup)
- `fleetAgentLogo()` for `claude-2` / Stillpoint mark (`src/lib/fleet-agents.ts` + tests)
- Portable Linux controller reaper + E2E OpenClaw docs/memory/links (PRs #5–#8)

## Deferred / blocked

### Overview modular board
Tracked in `TODO-overview-modular-board.md`. Geometry + persist helpers exist; store/grid/tiles/settings wiring not started. Worktree path in the TODO is stale (`.claude/worktrees/` empty). Resume as a dedicated feature branch, not mixed into chat/desktop work.

### Ruflo MCP (`CLAUDE_PLUGIN_ROOT`)
Host plugin cache: `~/.claude/plugins/cache/ruflo/ruflo-core/0.2.6/`.
MCP is **intentionally disabled** (`MCP-DISABLED.md`, `.mcp.json` → `.mcp.json.disabled`) to drop ~330 `mcp__plugin_ruflo-core_ruflo__*` tools. Hooks still resolve `scripts/ruflo-hook.cjs` via `process.env.CLAUDE_PLUGIN_ROOT` (Node join, not shell `${…}`).
**Unblock:** `mv .mcp.json.disabled .mcp.json` in that plugin dir only when you want the swarm MCP surface back; verify with `mcp tool call mcp_status`. Not a Mission Control app code change.

### Fly ops commissioning
Per `docs/fly-worker-audit.md`: **not commissioned** for large runs. Doppler previously denied restricted `mission-control/prd` secrets. Do not invent secrets — operator must grant Doppler/Fly tokens, then follow `docs/fly-agent-workers.md` / commissioning reports.

### Mega-files (debt)
Largest panels still >2k LOC (`agent-detail-tabs`, `task-board-panel`, `office-panel`, `task-dispatch`). Split opportunistically; no drive-by rewrite this pass.

### OpenAPI parity TODOs
`scripts/api-contract-parity.ignore` still lists routes from PRs #487 / #550 / #552 pending specs.

## Fly secret blockers (documentation only)

Required before live commission (names only — values must come from Doppler/operator):

- Fly API token / app credentials used by `MC_FLY_*` / `FLY_API_TOKEN`
- Doppler access to `mission-control/prd` (previously denied)
- Regional price env + budget caps as documented in fly-scale-architecture

## Test plan

- [ ] `pnpm exec tsc --noEmit` (or project typecheck script)
- [ ] Smoke: trigger 401 path → toast "Session expired" appears once
- [ ] QI on PR targeting `dev`
