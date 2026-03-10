# System Architecture

## As-Is Workspace
- Root repo: `mission-control`
- Primary runtime: Next.js 16 app in `src/`
- UI capability: existing mission-control dashboard with real-time panels, tasks, agents, chat, logs, scheduler, and observability
- Local orchestration prototype: `ai-orchestrator/` with Node-based scan, plan, review, and report outputs
- Reference source tree: `crewAI/` nested Git repository used as agent/orchestration pattern source

## Current Runtime Layers
1. Presentation
   - `src/app/` App Router shell
   - `src/components/` dashboards, panels, layout, and chat surfaces
2. Application
   - `src/lib/` auth, SQLite access, scheduler, runtime services, orchestration helpers, session management, validation
3. Data
   - `.data/` local SQLite and runtime artifacts
4. Supporting artifacts
   - `docs/`, `scripts/`, `ops/`, `tests/`

## Discovery Findings
- The existing dashboard is the strongest starting point for Marcuzx Forge Observatory because it already surfaces live system, agent, and task telemetry.
- `ai-orchestrator/` is the strongest starting point for Marcuzx Forge Control because it already models repository scanning, planning, review, delivery, and team memory.
- No separate local repository matching `vehicle-booking-system` was discoverable inside this writable workspace during this pass.

## Gaps
- No unified Marcuzx Forge platform namespace
- No machine-readable project registry
- No standardized module documentation across the planned factory modules
- No explicit Eak AI Factory agent operating specs
- No dedicated platform route inside the UI for the new factory layer
