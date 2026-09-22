# Jev Workspace Product Requirements

## Outcome

Opening **Jev** starts a project-scoped setup conversation. An authenticated setup model helps a novice describe a decision, asks only necessary multiple-choice questions, and proposes a complete typed Jev policy. After explicit approval, Mission Control opens an evaluation workspace modeled on the supplied sorter references.

Jev remains the probability evaluator. The setup model drafts and revises configuration; it never impersonates Jev, selects repositories, publishes a policy, or runs an evaluation without approval.

## Primary flow

1. Select Jev in Mission Control.
2. Select a project or start from the active project.
3. Describe the desired decision in ordinary language.
4. Answer short, adaptive choices about scope, evidence, output shape, and review behavior.
5. Review the generated names, Yes/No, Choose one, and Score questions.
6. Approve the policy and inspect the exact outbound context.
7. Run Jev against the current repository or pasted evidence.
8. Inspect probability distributions, usage, latency, model version, and history.
9. Reopen the saved setup session under its project and revise it conversationally.

## Information architecture

- A full-height workspace replaces the former settings-style page.
- The left rail is grouped by project and contains setup sessions/policies and recent runs.
- The main pane is chat-first for a new session and becomes the sorter workspace after approval.
- The sorter workspace keeps a question rail, compact run toolbar, result grid, and optional context/schema inspector visible without navigating away.
- On small screens the rail and inspector become drawers and question editing becomes full-screen.

## Frontend components

- `JevWorkspace`: owns the active project, session, policy, question, run, and pane.
- `JevProjectRail`: project/session history, search, new session, rename/archive, recent activity.
- `JevAssistantThread`: user messages, assistant summaries, structured choices, draft revisions, and approval diffs.
- `JevAssistantComposer`: multiline text, provider label, cancel/retry, Enter-to-send, and safe error recovery.
- `JevQuestionRail`: ordered questions with active checkbox, answer type, edit action, and new-question action.
- `JevQuestionDialog`: accessible modal with a three-way answer-type selector and sticky actions.
- `JevNoulEditor`: name, atomic question, optional yes/no definitions, and an application threshold.
- `JevChoiceEditor`: stable option key and human description rows with add/remove/reorder.
- `JevScoreEditor`: two to ten ordered descriptive levels with add/remove/reorder.
- `JevRunToolbar`: context source, model alias, selected-question filter, run/cancel state, and health.
- `JevResultGrid`: responsive probability cards for Noul, Choice, and Score.
- `JevHistory`: immutable prior evaluations with model, tokens, latency, safe errors, and optional approved preview.

## Backend components

- A dedicated no-tools setup-provider adapter with strict structured output, bounded time/cost/output, minimal environment, no session persistence, and no repository access.
- Workspace/project-scoped setup sessions, ordered messages, and immutable draft revisions.
- Existing workspace/project-scoped Jev policies and evaluations remain the execution source of truth.
- Server-owned project-to-checkout bindings are the only way to load local repository context.
- Policy targets are derived from authenticated server-side project selections.
- Question and result schemas are strictly validated at every boundary.
- Audit events contain IDs, counts, models, timing, and safe status only—never prompts, repository content, credentials, or provider stderr.
- An atomic SQLite outbox mirrors redacted policy, run, chat, revision, and approval-link events to the pinned Webdev Supabase project. SQLite remains authoritative and the UI distinguishes local, pending, retrying, and acknowledged saves.

## Question behavior

- **Yes / No (Noul):** one atomic proposition; show probability of yes and no. Never fabricate a confidence field.
- **Choose one (Choice):** exhaustive unordered options; show the selected option, the complete normalized distribution, and provider confidence.
- **Score:** two to ten ordered descriptive levels; show expected fractional score, complete level distribution, legend, and provider confidence.
- Thresholding, filtering, counts, dates, arithmetic, sorting, and aggregation are deterministic Mission Control logic, not Jev instructions.
- Editing a decision threshold reclassifies stored probabilities without calling Jev again.

## Repository context

- `pasted`: send only operator-reviewed pasted text/JSON.
- `metadata_only`: send server-controlled project metadata and no checkout files.
- `safe_repository`: send a bounded allowlist of manifests and documentation from a server-bound checkout plus redacted Git metadata.
- Never infer a checkout from a client-editable slug, description, or path.
- Raw source, `.env`, credentials, private keys, Git internals, and symlinks are excluded.

## Security and privacy acceptance

- Every route resolves tenant, workspace, project, session, policy, and evaluation ownership from authenticated server state.
- Assistant-bound data is recursively redacted, encoded as one untrusted payload, and never placed in command arguments.
- The provider subprocess receives only an allowlisted environment and runs with customizations, tools, MCP, browser, hooks, settings, and persistence disabled.
- The TypeSafe key remains server-side in Doppler.
- External calls have a ten-second timeout and one retry; the setup provider has bounded time, output, and spend.
- Input, schema size, nesting, question count, and rate limits fail closed with user-safe errors.
- Every paid evaluation requires a UUID idempotency key; retries replay a completed result or fail closed without making a second uncertain provider call.
- State is stored as a hash and length by default; a bounded redacted preview requires explicit opt-in.

## Visual requirements

- Question editor width: up to 1040px with a scrollable body and always-visible footer.
- Three equal answer-type segments, 40–44px controls, and a low-contrast cyan selected state.
- Project/question rail: 256px default, keyboard-resizable on desktop.
- Result grid: three columns on wide screens, two on medium screens, one on narrow screens.
- Cards use a shared grid border and compact probability bars instead of unrelated floating tiles.
- Mission Control colors, typography, focus rings, and dark surfaces replace the reference product’s branding.

## Testing and release gates

- Unit tests for every public parser, repository helper, question editor transform, and result validator.
- Route tests for auth roles, cross-tenant/workspace/project access, mismatched targets, limits, rate limiting, provider errors, and atomic writes.
- Migration tests for fresh install, upgrade, idempotence, legacy rows, malformed JSON, and foreign-key integrity.
- Deterministic Playwright flows for first chat, clarification, draft review, all three question editors, safe context preview, evaluation, history, provider recovery, mobile layout, keyboard navigation, and screenshots.
- Production verification covers Jev health, setup-provider health, each configured repository, no-secret logs/processes/errors, and fail-closed behavior when credentials are unavailable.

## Deferred batch scope

CSV/JSONL datasets, durable multi-item jobs, progress/cancel/retry, aggregate cross-repository distributions, and exports require separate workspace-scoped dataset/run/result tables and workers. Those controls must not appear enabled until that backend ships and passes tenant isolation, idempotency, budget, retention, and export-injection tests.
