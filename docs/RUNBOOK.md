# Runbook

## Purpose
Operate the Marcuzx Forge MVP inside the existing Mission Control repo without disrupting the current application runtime.

## Local Use
1. Install dependencies for the existing app.
2. Start the app with the standard dev or production commands already used by Mission Control.
3. Open `/forge` for the control center view.
4. Open `/forge/observatory` for the readiness and observability view.

## Source Of Truth
- Registry: `marcuzx-forge/registry/projects.json`
- Module metadata: `marcuzx-forge/registry/modules.json`
- Agents: `marcuzx-forge/agents/*.md`
- Memory: `marcuzx-forge/memory/`
- Repo-level architecture: `docs/*.md`

## Change Process
1. Update registry and module docs.
2. Record architectural rationale in `docs/DECISIONS.md` and memory snapshots.
3. Validate the Next.js app still builds and typechecks.
4. Commit only the Marcuzx Forge changes.
