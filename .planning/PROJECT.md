# Mission Control Agent Orchestration Platform

## Vision

Transform Mission Control from an AI agent monitoring dashboard into the definitive open-source platform for orchestrating AI agent teams — enabling complex multi-agent workflows with spatial visualization, structured deliberation, deep persona simulation, self-scaling, and human-in-the-loop oversight.

## Context

Mission Control v2.0.0 provides a strong foundation: 158 API routes, 33 dashboard panels, 57 database migrations, 870 tests, RBAC auth, SSE real-time events, LLM router with tiered adapters, agent framework integrations, and a Zustand-powered UI. The codebase is well-tested, TypeScript-strict, and follows consistent conventions.

The gap analysis (from AI Town blueprint) identified 6 missing capabilities that would elevate MC from a monitoring tool to an orchestration platform. All 6 build on existing infrastructure — no new frameworks needed, `@xyflow/react` is already in dependencies.

## Requirements

### Validated

- ✓ Agent CRUD + lifecycle management (create, configure, start, stop, delete) — existing
- ✓ Task board with status tracking (inbox, assigned, in_progress, completed) — existing
- ✓ Real-time SSE events for agent status and task updates — existing
- ✓ Tiered LLM router (fast/standard/complex) with budget enforcement — existing
- ✓ RBAC authentication (admin/operator/viewer) with session + API key + agent keys — existing
- ✓ Agent framework adapters (AutoGen, CrewAI, LangGraph, Claude SDK, OpenClaw) — existing
- ✓ Webhook system with HMAC signatures and retry — existing
- ✓ Cron scheduler for recurring tasks — existing
- ✓ Quality review system — existing
- ✓ Notification and alert system — existing
- ✓ Hermes chat/messaging system — existing
- ✓ Multi-tenant workspace isolation — existing
- ✓ Skill registry with security scanning — existing
- ✓ Audit logging for security-sensitive operations — existing
- ✓ CSP nonces, security headers, timing-safe auth — existing
- ✓ 870 tests (69 unit files, 84 E2E specs), CI quality gate — existing

### Active

- [ ] **Spatial 2D Visualization** — Interactive @xyflow/react canvas showing agent nodes, relationship edges, message flow animations, and team topology. Agents positioned in a virtual office layout with drag/zoom. Click agent → detail panel.
- [ ] **Structured Workflow Engine** — Define SOP templates as ordered phases with input/output artifact schemas. Agents assigned to phases auto-receive artifacts from upstream. Phase transitions enforce artifact validation. Supports: sequential, parallel, and conditional branching.
- [ ] **Debate/Consensus Rooms** — Create deliberation sessions where N agents argue positions on a topic. Structured rounds (propose → critique → rebut → vote). Moderator agent enforces protocol. Final consensus or majority decision recorded. Viewable as threaded argument tree.
- [ ] **Deep Persona Simulation** — Big Five personality traits (OCEAN scores), emotional state (valence/arousal), cognitive biases (confirmation, anchoring, etc.), relationship memory (trust scores between agent pairs). Personas influence LLM prompt construction and decision-making.
- [ ] **Auto-Hiring/Self-Scaling** — Agents monitor their own task queue depth and response latency. When overloaded, emit a "hire request" event with desired specialization. Orchestrator evaluates, spawns new agent from template, assigns subset of queue. Scale-down when idle threshold reached.
- [ ] **@Mention Team Chat** — Extend Hermes chat with @agent_name mentions that route messages to specific agents. Agents auto-respond in channel. Humans and agents share the same chat timeline. Support @all for broadcast, @team:name for team addressing.

### Out of Scope

- Mobile app — Dashboard is desktop-first (responsive later)
- Multi-node clustering — Single-server SQLite deployment (PostgreSQL migration is future work)
- Billing/payment integration — Open-source, no monetization
- Custom LLM fine-tuning — Use existing provider APIs as-is
- Video/audio channels — Text-based communication only
- Convex or external real-time DB — Stay with SQLite + SSE

## Technical Constraints

- **Database:** SQLite (better-sqlite3) — all new tables via migration system in `src/lib/migrations.ts`
- **State:** Zustand 5 for client state, SSE for real-time sync
- **Styling:** Tailwind CSS 3 with existing CSS variable theme system
- **Testing:** Vitest for unit, Playwright for E2E, 60% coverage threshold
- **No icon libraries:** Raw text/emoji per CLAUDE.md convention
- **No `Co-Authored-By`:** Per CLAUDE.md commit convention
- **Package manager:** pnpm only
- **Node.js:** >= 22
- **Build:** Standalone output for deployment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use @xyflow/react for spatial viz | Already in deps, mature React Flow library | — Decided |
| Extend Hermes for @mention chat | Existing chat system has messages + channels infrastructure | — Decided |
| SQLite for all new tables | Consistency with existing data layer, no new dependencies | — Decided |
| Store personas as JSON columns | Flexible schema for Big Five + emotional state + biases | — Pending |
| Workflow engine in src/lib/ | Business logic layer, not UI or API layer | — Decided |
| Auto-scaling via event bus | Use existing SSE + event bus for hire request events | — Decided |
| Phase-based migration approach | Each feature gets its own numbered migration(s) | — Decided |

## Success Criteria

1. All 6 features functional with unit + E2E tests
2. Zero increase in `any` type usage (use proper types for all new code)
3. No regression in existing 870 tests
4. Each feature has its own migration, API routes, and panel
5. Spatial visualization renders 50+ agents without frame drops
6. Workflow engine handles 10-phase SOPs with artifact validation
7. Debate rooms support 5+ agent participants with structured rounds
8. Auto-scaling responds within 30 seconds of overload detection
9. @mention chat delivers to correct agent within 1 second

---

*Last updated: 2026-03-15 after initialization*
