# Jev sorter workspace

Ready setup chats open a light sorter workspace: setup tabs, editable question rail,
count cards, score averages, run scopes, result filters, and JSON export. Browse
opens the existing project/chat history; Edit in chat returns to the setup assistant.

## Data and privacy contract

- Existing policies, evaluations, authorization, server-only TypeSafe credentials,
  and configured Supabase outbox remain authoritative. No new credential store.
- Paste text/JSON as one item, or a JSON array of 1–100 items. Prepare validates
  and fingerprints locally; Run is the explicit send to TypeSafe. Input is never
  placed in browser storage. Leaving the setup clears it; re-paste to rerun.
- Exact duplicate inputs are counted once. Cards use the newest successful result
  for each input, matching the current project, policy, question schema, and model.
  Only the latest 200 project evaluations are loaded; this limit is shown in the UI.
- The four scopes are unsorted, first 25, first 100, and all. Only unsorted reuses
  results. Other scopes explicitly rerun their selected items. Every request uses
  the existing server validation, audit and idempotency machinery.
- Requests run sequentially, with 6.5 seconds between calls to respect the shared
  10/minute heavy-operation limit. Stop finishes the in-flight item and cancels the
  remainder. Navigating away stops future calls. Failures preserve completed work;
  refresh before retrying an ambiguous failure.
- Checkboxes hide/show cards, not API questions. All saved questions run together.
- Yes threshold is a local, view-only recount; it resets to 50% when reopened.
  Score buckets use nearest level; averages retain fractional scores and display
  one-based levels. Original answers/confidence remain in detail records and export.
- Export contains the filtered answers, model, usage and latency, not input text,
  credentials, creator identity, or input fingerprints. No invented cost estimates.

## Verification

Targeted unit/component tests include invalid input, depth/size caps, exact hashes,
deduplication, all scopes, stale schema/model/project exclusion, state switches,
viewer restrictions, failure redaction, and 250 count-conservation property cases.
`tests/jev-sorter-flow.spec.ts` covers all three editors, reviewed input, run/filter/
export/reload, and 390×844, 1024×768, 1440×900 layouts with synthetic API fixtures.
The existing chat-first end-to-end test now ends in the sorter. These fixture tests
are not evidence of live provider, email connector, or all-repository certification.

## Deliberate limits

This change does not provision email/YouTube/Google connectors, persist customer
datasets, add an unbounded background queue, or execute the broader harness plan.
Source tabs represent real saved setups rather than invented connected datasets.
Large datasets and durable resumable batches need the approved connector/data-plane
work. The old one-item workbench remains available in source for compatibility but
is no longer the rendered Evaluate surface.

Official contracts checked September 21, 2026:
[Noul](https://docs.typesafe.ai/primitives/noul),
[Choice](https://docs.typesafe.ai/primitives/choice),
[Score](https://docs.typesafe.ai/primitives/score).
