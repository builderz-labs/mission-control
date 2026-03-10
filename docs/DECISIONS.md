# Decisions

## 2026-03-10

### D-001
Marcuzx Forge is initialized inside the existing `mission-control` repository instead of forcing a new monorepo or immediate repo split. This preserves the working dashboard and lowers migration risk.

### D-002
The existing Mission Control UI is treated as the observability base, while `ai-orchestrator/` is treated as the control-plane pattern source.

### D-003
The first memory layer is file-based and human-readable. Database-backed memory is deferred until platform workflows stabilize.

### D-004
The first UI exposure is delivered through additive `/forge` routes instead of modifying the already-dirty main dashboard shell.
