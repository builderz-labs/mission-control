# Jev in Mission Control

Mission Control exposes Jev by TypeSafe AI as a repository-scoped evaluation studio at `/jev`.
Every active Mission Control project can have independent reusable policies and evaluation history.

Jev is the typed probability engine, not the conversational assistant. Mission Control uses a separate,
no-tools Claude setup assistant to translate an operator's intent into an editable Jev policy. The UI labels
these responsibilities separately and requires an explicit review before a policy is saved or evaluated.

## Runtime configuration

Production reads `TYPESAFE_API_KEY` from Doppler project `backend`, config `prd`. The credential is
server-only and must never use a `NEXT_PUBLIC_` name. Optional SDK settings are:

- `TYPESAFE_DEFAULT_MODEL` — defaults to `jev-latest`.
- `TYPESAFE_BASE_URL` — keep the official endpoint unless using an approved test proxy.

The application uses the official JavaScript SDK with a 10-second timeout per attempt and one retry.
The repository supply-chain policy currently pins SDK `0.5.7`; upgrade only after a newer release has
passed the configured seven-day minimum release age and the Jev regression suite.

The Jev status badge is based on a cached, synthetic Noul request—not key presence alone. The probe sends no
repository or user context, retries once, and exposes only a safe health code. A failed probe disables new runs
until connectivity recovers while leaving policies and history readable.

## Operator workflow

1. Open **Jev** from the Automate section.
2. In **Setup**, describe the decision in normal language. Choose **Use recommended setup** or answer one
   short clarification at a time. Each clarification shows the consequence and a recommended choice.
3. Choose pasted context, the current repository, selected repositories, or all current repositories. An
   all-repository policy is created independently per repository; repository trees are never concatenated.
4. Review the plain-language summary, exact typed schema, tests, risks, observability, trigger, enforcement,
   retention, and repository list. Conversational revisions return a new draft and never activate it.
5. Explicitly save the reviewed policy. Bulk creation is transactional: either every selected repository gets
   its policy or none do.
6. In **Workbench**, select **Load repository context**. Mission Control prepares a reviewable JSON snapshot using project
   metadata, repository structure, Git status, and allowlisted documentation and manifests.
7. Review or edit the exact outbound context, then select **Evaluate with Jev**.
8. Inspect the resolved model, typed answers, probability distribution, confidence where Jev supplies it,
   token usage, latency, and history.

Custom policies can combine one or more typed questions:

   - **Noul** returns the probability of a yes answer.
   - **Choice** selects one named option and returns its probability distribution.
   - **Score** returns a probability-weighted score across two to ten ordered levels.

Policies default to `shadow` mode. Mission Control does not automatically block merges, deployments,
or agent tasks based on Jev output. Add enforcement only after representative calibration data exists.

## Setup assistant boundary

The setup provider uses the host's authenticated Claude CLI with no tools, no MCP servers, no browser,
no session persistence, an empty temporary working directory, strict JSON-schema output, a 60-second timeout,
one retry, an output cap, cancellation, and an identity-scoped rate limit. Prompts are sent over standard input
and are never included in audit logs. Repository IDs, workspace identity, trigger, enforcement, rollout, and
retention are derived and validated by Mission Control rather than accepted from model output.

Pasted text is treated as untrusted data. Injection-like content is isolated in a data envelope and surfaces a
review warning; it cannot grant tools or silently expand repository scope. Detected credentials are redacted
before generation. Mission Control persists only the redacted exchange, validated assistant response, and
immutable structured revision. Raw provider prompts, credentials, repository context, and provider stderr are
never saved. Approval atomically links the exact reviewed revision to every policy copy it materializes.

## Agent and CI use

Authenticated agents and CI clients use the same routes as the UI:

- `GET /api/jev/policies?projectId=<id>`
- `GET /api/jev/sessions?projectId=<id>`
- `POST /api/jev/sessions`
- `GET|PATCH|DELETE /api/jev/sessions/<session-id>`
- `GET /api/jev/sessions/<session-id>/messages`
- `GET /api/jev/context?projectId=<id>&policyId=<id>`
- `POST /api/jev/policies`
- `POST /api/jev/policies/bulk`
- `POST /api/jev/assistant`
- `POST /api/jev/evaluations`
- `GET /api/jev/evaluations?projectId=<id>`
- `GET /api/jev/models`

Send the Mission Control client credential through the normal `x-api-key` header. Read credentials from
the job's secret store at runtime; never write them to scripts, command arguments, artifacts, or logs.
The complete request contracts are published in `/api-docs` and `openapi.json`.

An evaluation request supplies a new UUID `idempotencyKey`, `projectId`, either `policyId` or an ad-hoc
`questions` map, and an explicit `state`. Reusing the key with identical input replays the completed result
without another paid TypeSafe call; reuse for different input fails. Interrupted or failed commands fail closed
instead of silently charging again. Mission Control never scans or uploads a repository implicitly. The context
endpoint performs a local, read-only snapshot only after an operator asks for it, and evaluation still requires
a separate explicit action.

The generated snapshot includes up to 300 representative paths, extension counts, branch and changed-file
metadata, and up to 64 KB total from an allowlist of files such as README, AGENTS.md, package.json,
pyproject.toml, and go.mod. It excludes `.env`, credential/auth/secret files, raw source contents, build
outputs, dependency directories, and symlinks. Detected credential patterns are redacted before the snapshot
reaches the browser. Projects without a safe local checkout still work using Mission Control metadata.

## Privacy and audit behavior

- Raw state is not stored by default.
- Mission Control records a SHA-256 input fingerprint, serialized length, policy snapshot, answers, model
  version, usage, latency, request ID, actor, and timestamps.
- A reviewed policy can permit a maximum 500-character redacted preview for audit context; clients cannot
  override a policy that disables retention.
- API keys never leave the server and are not returned by status or integration endpoints.
- Provider errors are converted to stable, user-safe codes before storage or display.

## Webdev persistence

SQLite remains the command source of truth. Every Jev policy, evaluation, setup chat, message, revision, and
revision-to-policy approval link is queued atomically and mirrored to the explicitly pinned Supabase Webdev
project. The status panel distinguishes saved locally, sync pending/retrying, and acknowledged by Webdev.
Only redacted server-side event snapshots are mirrored; raw evaluation state, previews, hashes, checkout paths,
credentials, and provider output streams are excluded. Browser roles have no access to the archive table.

## Model management

`jev-latest` follows TypeSafe's stable alias. The resolved model version is recorded on every evaluation.
For calibrated thresholds or release gates, pin a tested version in the policy and re-run the calibration
suite before changing it. Jev accepts text and JSON-compatible state; it does not process image, audio, or
video inputs directly.

Jev questions should remain narrow and atomic. Exact arithmetic, counting, date comparison, deterministic
invariants, workflow authorization, and threshold actions belong in ordinary application code. A Noul near
0.5 is uncertain and has no separate confidence value. Choice and Score confidence describes concentration
of their probability distribution, not guaranteed correctness. Score is a fractional expected value, so the
UI displays its legend and full distribution. Large irrelevant state can reduce accuracy; the 1.13 model has a
64k overall request limit and a separate 32k limit for state plus the longest question, so Mission Control's
context builder remains intentionally smaller and reviewable.

TypeSafe states that requests and responses are not used for Jev training. Zero-data-retention is an enterprise
option and Mission Control does not claim it unless separately verified for the account.

Official references:

- <https://docs.typesafe.ai/introduction/quickstart>
- <https://docs.typesafe.ai/sdk/javascript>
- <https://docs.typesafe.ai/api>
- <https://docs.typesafe.ai/models>
- <https://docs.typesafe.ai/primitives>
- <https://docs.typesafe.ai/confidence>
- <https://docs.typesafe.ai/model-jaggedness/jev-1.13>
- <https://docs.typesafe.ai/legal>
