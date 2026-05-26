# Mission Control — Fork Customizations

Tracks what's custom (local changes) vs. upstream (builderz-labs/mission-control).  
Purpose: reduce drift risk, enable safe upstream merges, identify contribution candidates.

**Upstream:** https://github.com/builderz-labs/mission-control  
**Fork:** https://github.com/Scorp10N/mission-control  
**Pinned upstream tag:** (set this when Phase 6 dashboard work begins)

---

## Custom Changes (local only, not upstream)

Track additions here as they are made.

### Infrastructure

| Change | File | Why |
|--------|------|-----|
| `MC_PORT=3001` default | `.env` | Port 3000 owned by Open WebUI in MyLocalLLM stack |
| Docker compose profile for MyLocalLLM | (future) | yantra integration |

### Features (planned for Phase 6)

| Feature | Files | Status |
|---------|-------|--------|
| Routing log panel | (TBD) | Planned Phase 6 |
| Mission Router audit log ingestion endpoint | `src/app/api/routing-decisions/` | Planned Phase 6 |
| Memory review queue panel | (TBD) | Planned Phase 6 |
| Privacy class distribution chart | (TBD) | Planned Phase 6 |

---

## Upstream Features (do not override)

Everything not listed above is upstream. Preserve on merge:
- Task board + Kanban (6 columns)
- Skills Hub (ClawdHub + skills.sh)
- Agent evals (4-layer framework)
- Trust scoring + Aegis review
- Recurring tasks / cron
- Claude Code session tracking
- Framework adapters (OpenClaw, CrewAI, LangGraph, AutoGen, Pi, Hermes)
- Cost tracking panels
- MCP server (`scripts/mc-mcp-server.cjs`)

---

## Upgrade Policy

1. Check upstream release notes before merging.
2. If upstream changes files in `CUSTOMIZATIONS.md` table → manual merge required.
3. Run full test suite (`pnpm test`) after any upstream merge.
4. Update pinned upstream tag above after each successful merge.

---

## Contribution Candidates

Features that could go upstream (reduces maintenance burden):

| Feature | Notes |
|---------|-------|
| Routing audit log endpoint | Generic enough; any router could use it |
| Memory review queue | Useful for any memory-enabled agent |

Open upstream issue before implementing to avoid wasted effort.
