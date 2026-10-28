# AI Ops Hub — Upstream Evaluation (2026-10-03)

## Decision
Use **Builderz Labs Mission Control** as the fork base.

Canonical upstream:
- https://github.com/builderz-labs/mission-control
- MIT license
- Current cloned version: 2.3.0
- Local clone: C:\Dev\ai-ops-hub
- Git remote: upstream
- Custom branch: feat/ai-ops-hub-v0.1

## Why this base
It already contains the largest share of the requested product:
- Tasks and human review gates
- Projects
- Claude Code / Codex local discovery
- Token/cost tracking
- Skills Hub with local disk sync, registry install and security scanning
- Schedules / cron
- Activity / logs
- GitHub integration
- SQLite local control plane
- REST / CLI / MCP interfaces

The main work is therefore product simplification and user-specific workflow adapters, not rebuilding infrastructure.

## Other candidates checked

### Falaq Cockpit
Repo: https://github.com/Bumoro/falaq-cockpit-oss

Strong ideas to borrow:
- “Needs you” / browser approval emphasis
- Claude/Codex live sessions
- usage-limit gauges
- local-only operation

Why not the base:
- much narrower project/skill/workflow management surface
- optimized around session cockpit rather than multi-project operating system

### forxidian/agent-mission-control
Repo: https://github.com/forxidian/agent-mission-control

Strong ideas to borrow:
- read-only local Codex/Claude quota/session adapters
- local-first privacy
- lightweight dependency model

Why not the base:
- primarily observation/read-only
- less suitable for approvals → workflows → automation execution

### crates/mission-control-dashboard
GitHub search currently surfaces this repository name, but its package metadata and README identify the canonical project/repository as Builderz Labs Mission Control. We track the canonical upstream above.

## Integration principle
Do not copy entire competing projects. Borrow specific ideas or adapters only after:
1. license check
2. security review
3. need gate
4. smoke test
5. update this document and the AI Ops Hub architecture note

## v0.1 scope lock
The first implementation must remain small:
1. Approval-first Home
2. Marketing / Development workspaces
3. Projects
4. Agents + Usage
5. Skills
6. Automations
7. Shufuro Marketing as first real workflow

Do not expand into a general SaaS, multi-tenant hosted product, or agent framework.
