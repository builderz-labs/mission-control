# System Architecture

## As-Is Workspace
- Root repo: `mission-control`
- Primary runtime: Next.js 16 app in `src/`
- UI capability: existing mission-control dashboard with real-time panels, tasks, agents, chat, logs, scheduler, and observability
- Local orchestration prototype: `ai-orchestrator/` with Node-based scan, plan, review, and report outputs
- Reference source tree: `crewAI/` nested Git repository used as agent/orchestration pattern source
- Marcuzx Forge layer: additive platform namespace under `marcuzx-forge/` plus dedicated `/forge` UI routes and `/api/forge`

## Current Runtime Layers
1. Presentation
   - `src/app/` App Router shell
   - `src/components/` dashboards, panels, layout, chat, and Forge-specific pages
2. Application
   - `src/lib/` auth, SQLite access, scheduler, runtime services, orchestration helpers, session management, validation
   - `src/lib/forge/` filesystem-backed Marcuzx Forge metadata loader
3. Data
   - `.data/` local SQLite and runtime artifacts
   - `marcuzx-forge/registry/` JSON and YAML platform metadata
   - `marcuzx-forge/memory/` file-based institutional memory
4. Supporting artifacts
   - `docs/`, `scripts/`, `ops/`, `tests/`

## State Detection

### FOUND
- Marcuzx Forge Control: `marcuzx-forge/control/` and `/forge`
- Marcuzx Forge Agents: `marcuzx-forge/agents/`
- Marcuzx Forge Standards: `marcuzx-forge/standards/`
- Marcuzx Forge Registry: `marcuzx-forge/registry/`
- Marcuzx Forge Memory: `marcuzx-forge/memory/`
- Marcuzx Forge Observatory: `/forge/observatory` inside the existing Mission Control app
- Architecture docs, runbook, decisions log, changelog, and task system
- Project registry populated with real local projects

### PARTIAL
- Repo scanner and orchestration integration: `ai-orchestrator/` exists but is not yet live-wired into the Forge UI or API
- Multi-project handling: local discovery exists, but sync outside the current workspace is still manual
- Observatory telemetry: Forge readiness views exist, but PR/build telemetry and live orchestration status are not yet merged in

### MISSING
- Automatic external repo registration beyond the connected workspace
- Automated PR summary ingestion and long-term memory write-back
- Extracted multi-repo deployment of each Forge module

## Discovery Findings
- The existing dashboard is the strongest starting point for Marcuzx Forge Observatory because it already surfaces live system, agent, and task telemetry.
- `ai-orchestrator/` is the strongest starting point for Marcuzx Forge Control because it already models repository scanning, planning, review, delivery, and team memory.
- No separate local repository matching `vehicle-booking-system` was discoverable inside this writable workspace during this pass.
