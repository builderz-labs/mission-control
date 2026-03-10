# Runbook

## Purpose
Operate the Marcuzx Forge MVP inside the existing Mission Control repo without disrupting the current application runtime.

## Local Use
1. Install dependencies for the existing app.
2. Start the app with the standard dev or production commands already used by Mission Control.
3. Open `/forge` for the control center view.
4. Open `/forge/observatory` for the readiness and observability view.
5. Use `GET /api/forge` for machine-readable platform metadata.

## Source Of Truth
- Registry JSON: `marcuzx-forge/registry/projects.json`
- Registry YAML: `marcuzx-forge/registry/projects.yaml`
- Workspace scan: `marcuzx-forge/registry/workspace-scan.json`
- Module metadata: `marcuzx-forge/registry/modules.json`
- Agents: `marcuzx-forge/agents/*.md`
- Memory: `marcuzx-forge/memory/`
- Repo-level architecture: `docs/*.md`

## Operational Checks
- Run `node marcuzx-forge/control/index.mjs` to print the current control snapshot.
- Run `npm run typecheck` after structural changes.
- Verify `/forge` and `/forge/observatory` still render after platform updates.
- Confirm `/api/forge` returns the current registry, workspace scan, and parsed orchestrator output snapshot.

## Change Process
1. Update registry and module docs.
2. Record architectural rationale in `docs/DECISIONS.md` and memory snapshots.
3. Validate the Next.js app still typechecks.
4. Commit only the Marcuzx Forge changes when the wider worktree is dirty.
