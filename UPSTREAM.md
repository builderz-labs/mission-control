# UPSTREAM.md — Mission Control fork policy

**Lumina fork of** `builderz-labs/mission-control` (which is itself a hardening fork of `anthropic-ai/mission-control`).

This document defines how this fork tracks, integrates, and diverges from its upstream.

---

## Fork lineage

```
anthropic-ai/mission-control  (canonical upstream, alpha-stable)
    │
    ▼
builderz-labs/mission-control (security/ops hardening fork)
    │
    ▼
austinmao/mission-control     (this repo — Lumina platform integration)
```

## Why we fork

| Concern | Upstream behavior | Lumina need |
|---|---|---|
| Auth/session | Single-user file-based | Multi-tenant Clerk/cookie-driven |
| Branding/theme | builderz design tokens | `@lumina/design-tokens` (OD-canonical) |
| Deploy topology | Single container, dev-friendly | Per-tenant container, prod-hardened (Path A) |
| Cost UI | builderz-native cost panel | Phase 6 audit + edge-case probes (T13) |
| MCP trust boundary | builderz/upstream defaults | ADR-MCP-001 (6 defense layers) |
| Hooks/skills | Permissive defaults | Lumina goal-rules + per-tenant policy gates |

Each divergence costs **fork-debt** (merge conflicts on every upstream sync). We accept this in exchange for product-fit.

## Sync cadence

- **Weekly** automated commit-watch (`.github/workflows/upstream-watch.yml`) opens an issue if upstream has unpulled commits.
- **Monthly** manual rebase window — first Tuesday, ~1 hour budgeted.
- **Per-release** rebase before any cut of a Phase 2+ release.

Do NOT merge upstream commits ad-hoc between scheduled windows — increases drift risk + complicates rollback.

## Sync procedure

```bash
git fetch upstream
git checkout -b sync/upstream-YYYYMMDD upstream/main
git rebase main
# resolve conflicts (likely: src/lib/auth.ts, src/components/cost-panel/*, theme tokens)
pnpm install
pnpm test:all
git push -u origin sync/upstream-YYYYMMDD
gh pr create --title "sync: rebase on upstream main YYYY-MM-DD" --body "Pulled N commits from upstream..."
```

Reviewer checklist:
- [ ] All tests pass (lint + typecheck + unit + e2e)
- [ ] No regression in tenant-isolation tests
- [ ] Cost-panel + auth + MCP changes manually verified
- [ ] CHANGELOG.md updated with upstream version sync'd to

## Divergence inventory

Update this section whenever a new Lumina-only patch lands.

| Area | Files | Reason | Last sync conflict? |
|---|---|---|---|
| Multi-tenant auth | `src/lib/auth.ts`, `src/middleware.ts` | Clerk integration; per-tenant session | TBD |
| Design tokens | `src/styles/tokens.ts`, `tailwind.config.ts` | Import `@lumina/design-tokens` (D-T2) | TBD |
| Cost UI edge cases | `src/components/cost-panel/*` | Phase 6 audit fixes (T13) | TBD |
| MCP trust boundary | `src/lib/mcp/*` | ADR-MCP-001 6 layers | TBD |
| Hardened Docker compose | `docker-compose.hardened.yml` | Volume audit (T16) + per-tenant isolation | (inherited from builderz) |
| UPSTREAM.md / upstream-watch.yml | this file + workflow | Fork policy + automation | (Lumina addition) |

## When to upstream a patch

Should PR upstream:
- Bug fixes in builderz/upstream code
- Performance improvements
- Documentation/typo fixes
- Test infrastructure

Should stay forked:
- Lumina-specific multi-tenant logic
- @lumina/design-tokens integration
- ADR-MCP-001 enforcement (proprietary trust model)
- Phase 6 cost-attribution fixes specific to billing reconciliation

Open upstream PR via: `gh pr create -R builderz-labs/mission-control --base main --head sync/feature-YYYY-MM-DD`.

## Hold-the-line rules

1. **Never `--force-push` to main** in this fork.
2. **Never delete a Lumina-specific patch** without a paired upstream PR being merged.
3. **Never rebase without `pnpm test:all`** — better-sqlite3 native module + Playwright are common breakage points.
4. **Update this UPSTREAM.md** whenever you add a Lumina divergence.

## Upstream contacts

- builderz-labs maintainer: see [builderz-labs/mission-control issues](https://github.com/builderz-labs/mission-control/issues)
- anthropic-ai/mission-control: alpha, not for issues; security via security@anthropic.com

## Related Lumina artifacts

- `docs/artifacts/mc-deploy-runbook-phase-1-20260518.md` — deploy runbook (in openclaw repo)
- `docs/adr/mcp-trust-boundary.md` — MCP design constraints (in openclaw repo)
- `packages/lumina-design-tokens/` — token source of truth (in openclaw repo)
- `docs/artifacts/mc-od-shell-pivot-20260518.md` — pivot rationale (in openclaw repo)
