# Source-of-Truth Rules

## Brief
> Supabase / Postgres is the only source of truth in the DarkMada. Obsidian is a mirror. The local SQLite
> cache in this repo is a working cache. Conflicts always resolve in favour of Supabase.

## The hierarchy

| Layer | Role | Conflict resolution |
|---|---|---|
| **Supabase / Postgres** | Canonical truth | Always wins |
| **Local SQLite cache** | Working cache for DarkMada | Re-syncs from Supabase; never the authority |
| **Obsidian vault** | Human-readable mirror | Re-rendered nightly; local edits are drift, not truth |
| **In-memory state** (Zustand store) | Render state for the UI | Hydrates from API; never authoritative |

## Hard rules

1. **Every canonical write goes through Memory API** (an MCP service). Direct Postgres writes are forbidden.
2. **Mirror writers never read from the mirror as input.** The mirror is downstream only.
3. **The audit log is the second source of truth** for *what happened* — and is replicated independently.
4. **Cache invalidation** is event-driven. Memory API publishes `memory.changed` and the cache layer responds.
5. **Restore drills** test the Supabase backup monthly and write a record into `reports`.

## What "canonical" means here

Two things must be true for a row to be canonical:

- It was written by an MCP service that owns that table.
- The audit log has a corresponding entry with actor + reason.

If either is missing, the row is suspect and should be quarantined for review.
