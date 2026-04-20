# 07 — Mirror Brain (Obsidian)

The Obsidian vault is the **human-readable mirror** of the DarkMada. It is *never* the source of truth.

## What it contains

- `00 — Inbox` — raw captures awaiting triage
- `01 — Briefings` — daily Helmy briefs (mirror of `reports`)
- `02 — Research` — Velma's synthesized notes
- `03 — Memory snapshots` — nightly summaries from Dr Strange
- `04 — Decisions` — ADR-style records of accepted approvals
- `05 — People` — notes on humans the system interacts with
- `06 — Projects` — live initiatives + spec docs
- `99 — Archive` — read-only archive

## How it stays in sync

- Mirror cycle runs nightly at 23:00 (Dr Strange).
- Each file gets frontmatter with `truth_id` pointing back to the canonical record.
- Drift is detected by file mtime > sync mtime — surfaced in The Library.
- Local edits in Obsidian do not flow back automatically. To make them stick, the underlying record must be
  updated via Memory API. (A future "promote drift" tool may exist; not in v3.)

## Why a mirror at all

- Human-friendly browsing on iPad / phone without booting DarkMada.
- Plays well with offline review.
- Plain markdown is the most durable backup format the system has.
