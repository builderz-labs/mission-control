# Phase 5: Debate/Consensus — Summary

**Goal:** Structured multi-agent deliberation with voting, token budgets, and argument tree visualization

## What Was Built

### Schema (4 migrations)
- `debates` — topic, status state machine, round/max_rounds, token budget, vote tallies, workspace scoping
- `debate_arguments` — round_number, phase CHECK(propose/critique/rebut), confidence, tokens_used
- `debate_votes` — vote CHECK(accept/reject), reason, UNIQUE(debate_id, agent_id)
- `debate_participants` — composite PK(debate_id, agent_id)

### Engine (debate-engine.ts, 6 functions)
- `createDebate()` — writeTransaction, validates 2+ participants, resolves agent names
- `submitArgument()` — phase validation, duplicate check, token budget enforcement → budget_exhausted
- `advanceDebatePhase()` — propose → critique → rebut → vote → conclude/next round
- `castVote()` — phase gate, participant check, tallies accept/reject, returns allVoted flag
- `getDebateStatus()` — full read (debate + participants + arguments + votes)
- `concludeDebate()` — manual conclude with arbitrary outcome

### API Routes (6 new + 1 updated)
- `GET/POST/DELETE /api/debates` — list with pagination/status filter, create, admin delete
- `GET /api/debates/[id]` — full debate detail
- `GET/POST /api/debates/[id]/arguments` — list with round/phase filter, submit
- `POST /api/debates/[id]/advance` — phase advancement
- `POST /api/debates/[id]/vote` — cast vote
- `GET /api/debates/[id]/results` — outcome, tally, arguments by round
- `POST /api/debates/start` — updated to use debate-engine (backward compat)

### Panel (debate-panel.tsx)
- **List view:** Status filter pills, debate cards with topic/status/round/tokens, "New Debate" button
- **New debate form:** Topic input, max rounds, token budget, agent picker (toggle buttons)
- **Detail view:** Header with status/outcome badges, token budget meter, participant chips
- **Argument tree:** Grouped by round → phase (propose/critique/rebut), agent attribution, confidence %
- **Vote tally bar:** Green/red proportional bar with accept/reject counts
- **Advance Phase button:** Drives state machine from panel

### Tests
- **30 unit tests** (debate-engine.test.ts) — all functions + edge cases
- **37 unit tests** (debate-api.test.ts) — schema validation, boundaries, exports
- **17 E2E tests** (debate-rooms.spec.ts) — CRUD, full lifecycle, budget exhaustion, multi-round, auth

## Requirements Coverage

| Req | Description | Status |
|-----|-------------|--------|
| DEBT-01 | Create debate session with topic/participants/rounds | Done |
| DEBT-02 | Structured phases (propose/critique/rebut/vote) | Done |
| DEBT-03 | Token budget enforcement | Done |
| DEBT-04 | API routes for debate lifecycle | Done |
| DEBT-05 | Multi-round support with round advancement | Done |
| DEBT-06 | Argument tree visualization in panel | Done |
| DEBT-07 | Vote tallying with majority consensus | Done |
| DEBT-08 | Real-time status badges and progress | Done |
| DEBT-09 | Backward-compatible /api/debates/start | Done |
| DEBT-10 | Budget exhausted terminal state | Done |

## Quality Gate

- **TypeScript:** 0 errors
- **Unit tests:** 83 files, 1037 tests, 0 failures
- **E2E tests:** 732 passed, 0 failed, 1 skipped

## Key Files

### Created
- `src/lib/debate-engine.ts` (~365 lines)
- `src/components/panels/debate-panel.tsx` (~635 lines)
- `src/app/api/debates/route.ts`
- `src/app/api/debates/[id]/route.ts`
- `src/app/api/debates/[id]/arguments/route.ts`
- `src/app/api/debates/[id]/advance/route.ts`
- `src/app/api/debates/[id]/vote/route.ts`
- `src/app/api/debates/[id]/results/route.ts`
- `src/lib/__tests__/debate-engine.test.ts`
- `src/lib/__tests__/debate-api.test.ts`
- `tests/debate-rooms.spec.ts`

### Modified
- `src/lib/phase-migrations.ts` (4 migrations added)
- `src/app/[[...panel]]/page.tsx` (import + case 'debates')
- `src/app/api/debates/start/route.ts` (delegates to debate-engine)

## Commits
- `3dd9cfa` feat(05-01): debate schema, engine, and unit tests
- `586f311` feat(05-02): create debate CRUD and lifecycle API routes
- `2f6f3d9` refactor(05-02): update /api/debates/start to use debate-engine
- `63f12d2` test(05-02): add debate API validation unit tests
- `0205fc3` docs(05-02): complete debate API routes plan
- `95e2c07` feat(05-03): debate panel UI with argument tree and voting
- `7e3c01b` test(05-04): debate E2E specs — full lifecycle, budget, multi-round

## Duration
~10 minutes (3 waves)
