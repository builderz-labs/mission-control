# Target Architecture

## Target Shape
Marcuzx Forge operates as a multi-repo platform with a shared standards layer, registry, memory, and observability surface. This repo hosts the first integrated MVP.

## Target Modules
- `marcuzx-forge/control`: orchestration entrypoint and control-plane conventions
- `marcuzx-forge/agents`: Eak AI Factory role definitions
- `marcuzx-forge/standards`: reusable templates and conventions
- `marcuzx-forge/registry`: machine-readable project and module metadata
- `marcuzx-forge/memory`: file-based institutional memory
- `marcuzx-forge/observatory`: dashboard contract and UI routes
- `marcuzx-forge/projects`: discovered project snapshots and links

## Interaction Model
1. Control reads registry and module metadata.
2. Agents consume standards and memory before execution.
3. Observatory reads registry plus docs completeness to expose readiness state.
4. Human reviewers inspect architecture docs, decisions, and backlog before approving expansion to more repos.

## Evolution Path
- Phase 2: promote modules into separate repositories where operationally useful
- Phase 2: add database-backed memory and task state
- Phase 2: attach GitHub PR orchestration and branch automation per registry entry
