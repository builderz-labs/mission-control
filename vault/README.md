# Mission Control Knowledge Vault

A local-first, plain-markdown knowledge workspace for reviewed project notes, decisions, system maps, implementation handoffs, agent notes, and inbox items.

---

## Purpose

The Vault is a human-curated, version-controlled record of institutional knowledge for Mission Control. It is **not** an automated log, chat dump, or database mirror. Every entry here was deliberately placed by a person after review.

---

## Folder Structure

| Folder | Contents |
|---|---|
| `decisions/` | Architecture and product decisions with context, options considered, and rationale |
| `handoffs/` | Implementation handoff notes — what was built, what was left, what to know before touching it |
| `system-maps/` | Descriptions and diagrams of system topology, data flows, integration points |
| `session-summaries/` | Human-reviewed summaries of significant work sessions or milestones |
| `agents/` | Notes about agent behavior, capabilities, observed quirks, and integration details |
| `inbox/` | Unreviewed or unsorted items pending triage — temporary holding area only |

---

## Naming Conventions

Use lowercase kebab-case. Include a date prefix for time-sensitive documents.

```
decisions/2026-05-04-auth-strategy.md
handoffs/2026-05-04-vault-foundation.md
session-summaries/2026-05-04-vault-setup.md
agents/claude-code-behavior-notes.md
system-maps/mission-control-overview.md
inbox/rough-note-needs-review.md
```

---

## What Belongs in the Vault

- Decisions that are not obvious from the code
- Context that would otherwise be lost between sessions
- System topology that spans multiple files or services
- Handoff notes before a significant refactor or hand-off to another engineer
- Agent behavioral observations that inform prompting or integration choices
- Session summaries for milestones worth remembering

---

## What Does NOT Belong in the Vault

- Automatically generated logs or chat transcripts
- Duplicate information that already lives accurately in the codebase or git history
- Temporary scratch notes (use `inbox/` for those, then triage)
- Build artifacts, compiled output, or binary files
- Secrets or credentials of any kind

---

## Manual Review Requirement

Nothing is written to the Vault automatically. There is no chat-to-vault pipeline. Every file here was created or reviewed by a human. This is intentional — the Vault's value comes from curation, not volume.

---

## Git Behavior

The Vault is version-controlled alongside the rest of Mission Control. Normal `git` workflows apply:

- Commit Vault entries with meaningful messages (e.g. `docs(vault): add auth decision note`)
- Review Vault diffs in PRs the same as code
- The `inbox/` folder is for drafts — do not merge inbox items to main without promoting them to the correct folder

---

## Future Compatibility

This Vault uses plain GitHub-flavored Markdown with no proprietary extensions. It is compatible with:

- **Obsidian** — open the `vault/` folder as an Obsidian vault
- **Tolaria / Memplace** — import markdown files directly
- **Any text editor** — no special tooling required

Internal links using `[[WikiLink]]` syntax may be used if the team adopts Obsidian, but are not required and will not break plain rendering.
