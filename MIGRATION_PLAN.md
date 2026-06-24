# Asana → Mission Control migration plan

**Status:** Script ready · awaiting Gerda confirm to run for real
**Script:** `~/mission-control/scripts/asana-to-mc.mjs`
**Direction:** One-way — Asana stays as source of truth during parallel run.

## How to run

```bash
cd ~/mission-control

# 1. Always preview first
node scripts/asana-to-mc.mjs --dry-run

# 2. Smoke-test small batch (creates 5 real MC tasks)
node scripts/asana-to-mc.mjs --confirm --limit 5

# 3. Inspect Mission Control → confirm 5 land cleanly in "Inbox"
# https://mc.staylio.london (or http://204.168.227.30:4000)

# 4. Full import
node scripts/asana-to-mc.mjs --confirm

# Optional: override MC target
node scripts/asana-to-mc.mjs --confirm --mc-url http://127.0.0.1:3000 --mc-key <local-key>
```

## What the script does

| Step | Action |
|---|---|
| 1 | Reads `ASANA_PAT` from `~/james/.env` |
| 2 | Reads MC API key from `~/mission-control/HETZNER_PRODUCTION.md` |
| 3 | Loads ALL existing MC tasks · builds set of `asana:<gid>` already imported |
| 4 | Pulls Asana: my-tasks + 3 key projects (Current projects, Day-to-day VA, Operations Calendar) — incomplete only |
| 5 | De-dupes against the existing set — only NEW tasks go forward |
| 6 | Maps each: priority via due-date heuristic, assignee → MC agent or `human:<slug>` tag |
| 7 | POSTs to `/api/tasks` with `status='inbox'`, throttled to 5 req/sec |
| 8 | Writes receipts file to `~/mission-control/.data/asana-migration-YYYY-MM-DD.json` |

## Priority heuristic

Asana has no priority field on the standard task object, so due-date proximity is used:

| Asana due date | MC priority |
|---|---|
| Overdue | `critical` |
| ≤ 3 days | `high` |
| ≤ 14 days | `medium` |
| > 14 days or no due date | `low` |

## Assignee mapping

| Asana assignee | MC outcome |
|---|---|
| Name matches an agent (sofia/aria/marcus/etc) | `assigned_to: <agent>` |
| Known human (Gerda/Arianne/Hanna/Jose/Kris/Lukasz) | unassigned + tag `human:<name>` |
| Other / unknown | unassigned + tag `human:<slugified-name>` |
| No assignee | unassigned, no human tag |

## Tags added to every imported task

- `asana-migration` (lets you filter "everything imported")
- `asana:<gid>` (idempotency key)
- `human:<name>` (when assignee wasn't an agent)
- `project:<slugified-project-name>` (up to 3)

## Safety

| Risk | Mitigation |
|---|---|
| Duplicate tasks on re-run | Idempotency via `asana:<gid>` tag — script loads existing MC tasks first and skips matches |
| Run away creating thousands of tasks | `--limit N` flag · default refuses to run without explicit `--confirm` or `--dry-run` |
| Hammer MC API | 210ms between POSTs (~4.7 req/sec, under the 5/sec ceiling) |
| Destroy Asana | Script is read-only against Asana. Never deletes, completes, or modifies. |
| Wrong MC instance | `--mc-url` defaults to Hetzner prod; check the banner before confirming |
| Asana fetch fails for one project | Logged as WARN, other projects still proceed |

## Kill switch

If the script is mid-import and you need to stop:
```bash
# Ctrl-C in the terminal — safe at any time
# Already-created tasks stay in MC (each POST is atomic)
# Re-running picks up exactly where it left off (idempotency)
```

## Rollback

If imported tasks are unwanted in MC, delete by tag:
```bash
# Filter MC tasks by asana-migration tag → bulk delete via MC UI
# OR via API:
curl -s -H "x-api-key: $MC_KEY" "http://204.168.227.30:4000/api/tasks?limit=200" \
  | jq '.tasks[] | select(.tags | contains(["asana-migration"])) | .id' \
  | xargs -I{} curl -X DELETE -H "x-api-key: $MC_KEY" "http://204.168.227.30:4000/api/tasks/{}"
```

Asana is untouched, so nothing to roll back there.

## Expected volume (rough — confirm with dry-run)

Based on the team-questionnaire memo and Operations Calendar size (~3,031 tasks lifetime):
- **My tasks (Gerda assigned, incomplete):** ~30–80
- **Current projects (incomplete):** ~20–60
- **Day-to-day (VA) (incomplete):** ~10–40
- **Operations Calendar (incomplete):** could be 100–500+ — main unknown, will see in dry-run

Dry-run reports the exact count before any real write.

## After the import

1. Filter MC by tag `asana-migration` → triage the inbox
2. Asana remains source of truth for at least one week (parallel run)
3. Once team validates MC reflects reality, deprecate Asana (separate decision — not this script's job)

## Receipts

Every real run writes a JSON file:
- Path: `~/mission-control/.data/asana-migration-YYYY-MM-DD.json`
- Contents: `created[]` (asana_gid + mc_id + title), `failed[]`, `stats`, `timestamp`
- Persists across runs — append-style review

## Open question for Gerda before full import

- Operations Calendar has ~3k historical tasks; pulling all incomplete from there could flood the inbox. **Recommend:** start with `--limit 50` smoke-test, then look at the count from a full `--dry-run` and decide whether to filter Operations Calendar by section (e.g. only future-dated) before the real run. Script supports this via the existing `--limit` flag for now; a section-filter flag can be added if the count is unmanageable.
