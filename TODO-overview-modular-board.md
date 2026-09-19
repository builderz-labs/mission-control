# TODO later: Overview modular board

Paused 2026-09-03. Do not mix with `docs/agents-md-adapter` or the live `chat-desktop-parity` server.

## Resume

```bash
cd ~/Dev/mission-control/.claude/worktrees/overview-modular-board
# branch: feat/overview-modular-board (from fork/main @ 4dceb78)
```

Approved plan: `~/.grok/sessions/%2FUsers%2Ftylerdevries/01a068d7-c319-7522-8136-f3a4dfba0c3c/plan.md`

## Decisions (locked)

- Hybrid board: KPI widgets + live session tiles
- 12-col snap grid, drag + resize
- Auto-add live CLI/remote/gateway sessions; unstarred tiles leave when the session ends
- Card first, expand to live PTY (one at a time)
- Overview only
- Persist localStorage immediately, debounce to `/api/settings` `dashboard.board_v1`

## Done

- [x] Geometry: `src/lib/dashboard-board.ts`
- [x] Persist helpers: `src/lib/dashboard-board-persist.ts` (TextEncoder, 32KB cap, legacy `mc-dashboard-layout` migrate)
- [x] Tests: `src/lib/__tests__/dashboard-board.test.ts`, `dashboard-board-persist.test.ts` (not run yet this pause)
- [x] Grok/Kimi logos already on this branch (`public/brand/`, `session-kind-brand.tsx`)

## Not started

- [ ] `src/store/dashboard-board-store.ts` (do **not** grow `src/store/index.ts`)
- [ ] `src/lib/use-dashboard-board-sync.ts`
- [ ] `src/lib/dashboard-board-settings.ts` — debounce PUT `/api/settings`
- [ ] `src/components/dashboard/board-grid.tsx`
- [ ] `src/components/dashboard/board-tile.tsx`
- [ ] `src/components/dashboard/session-tile.tsx`
- [ ] Rewrite `widget-grid.tsx` to compose BoardGrid
- [ ] Draggable rows in `session-workbench-widget.tsx` (`application/x-mc-session`)
- [ ] Add `dashboard.board_v1` to `src/app/api/settings/route.ts` definitions
- [ ] Expand overlay: mount `TerminalView` for tmux Claude/Codex only; others → Chat
- [ ] Run `pnpm exec vitest run src/lib/__tests__/dashboard-board.test.ts src/lib/__tests__/dashboard-board-persist.test.ts`
- [ ] Desktop + ~390px Overview check

## Constraints

- Source files ≤ 200 lines
- Never mount more than one PTY on Overview
- Do not fake terminals for Grok/Kimi/gateway
