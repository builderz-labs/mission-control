# 03 — Data + Memory Spine

The spine is **Supabase / Postgres**. This is the only canonical store. Everything else mirrors or projects
from it.

## Tables

| Table | Purpose | Storage | Truth |
|---|---|---|---|
| `memory` | Long-term semantic memory (text + embeddings) | pgvector | canonical |
| `ideas` | Captured raw ideas before triage | pgvector | canonical |
| `tasks` | Operational task graph | relational | canonical |
| `knowledge` | Curated docs, distilled from research | pgvector | canonical |
| `reports` | Velma + Helmy outputs | pgvector | canonical |
| `artifacts` | Generated assets (code blobs, images, PDFs) | Storage | canonical |
| `approvals` | Gated actions awaiting Jackson sign-off | relational | canonical |
| `audit_logs` | Immutable trail of every agent + system action | relational, append-only | canonical |

## Write path

1. Agent emits an event via the MCP Event Bus.
2. Memory API normalizes + writes to the relevant table.
3. Dr Strange schedules embedding for vectorized tables (queue-driven).
4. Audit log records the actor, model, and cost.

## Read path

1. Agent calls Retrieval Layer with query + scope.
2. Hybrid search: vector + keyword + recency boost.
3. Context Loader assembles the prompt with citations.
4. Cited memory ids are written into the run record so prompts are reproducible.

## Mirror path (Obsidian)

1. Nightly roundup picks salient docs (decided by Dr Strange).
2. Renders to readable markdown with frontmatter.
3. Writes into the Obsidian vault — **mirror only**.
4. Local edits do *not* flow back. Drift is visible in The Library surface.

## Backup posture

- Postgres snapshotted nightly to encrypted off-host storage.
- `audit_logs` replicated independently with an extra retention bucket.
- Restore drills monthly — automated, with a drill record landed in `reports`.
