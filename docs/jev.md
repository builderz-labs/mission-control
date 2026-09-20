# Jev in Mission Control

Mission Control exposes Jev by TypeSafe AI as a repository-scoped evaluation studio at `/jev`.
Every active Mission Control project can have independent reusable policies and evaluation history.

## Runtime configuration

Production reads `TYPESAFE_API_KEY` from Doppler project `backend`, config `prd`. The credential is
server-only and must never use a `NEXT_PUBLIC_` name. Optional SDK settings are:

- `TYPESAFE_DEFAULT_MODEL` — defaults to `jev-latest`.
- `TYPESAFE_BASE_URL` — keep the official endpoint unless using an approved test proxy.

The application uses the official JavaScript SDK with a 10-second timeout per attempt and one retry.
The repository supply-chain policy currently pins SDK `0.5.7`; upgrade only after a newer release has
passed the configured seven-day minimum release age and the Jev regression suite.

## Operator workflow

1. Open **Jev** from the Automate section.
2. Select any repository-backed Mission Control project.
3. If the repository has no policies, choose a starter goal. **Release readiness** is the recommended
   first evaluation and combines all three answer types.
4. Select **Load repository context**. Mission Control prepares a reviewable JSON snapshot using project
   metadata, repository structure, Git status, and allowlisted documentation and manifests.
5. Review or edit the context, then select **Evaluate with Jev**.
6. Inspect the resolved model, typed answers, probability distribution, token usage, latency, and history.

Custom policies can combine one or more typed questions:

   - **Noul** returns the probability of a yes answer.
   - **Choice** selects one named option and returns its probability distribution.
   - **Score** returns a probability-weighted score across two to ten ordered levels.

Policies default to `shadow` mode. Mission Control does not automatically block merges, deployments,
or agent tasks based on Jev output. Add enforcement only after representative calibration data exists.

## Agent and CI use

Authenticated agents and CI clients use the same routes as the UI:

- `GET /api/jev/policies?projectId=<id>`
- `GET /api/jev/context?projectId=<id>`
- `POST /api/jev/policies`
- `POST /api/jev/evaluations`
- `GET /api/jev/evaluations?projectId=<id>`
- `GET /api/jev/models`

Send the Mission Control client credential through the normal `x-api-key` header. Read credentials from
the job's secret store at runtime; never write them to scripts, command arguments, artifacts, or logs.
The complete request contracts are published in `/api-docs` and `openapi.json`.

An evaluation request supplies `projectId`, either `policyId` or an ad-hoc `questions` map, and an explicit
`state`. Mission Control never scans or uploads a repository implicitly. The context endpoint performs a
local, read-only snapshot only after an operator asks for it, and evaluation still requires a separate
explicit action.

The generated snapshot includes up to 300 representative paths, extension counts, branch and changed-file
metadata, and up to 64 KB total from an allowlist of files such as README, AGENTS.md, package.json,
pyproject.toml, and go.mod. It excludes `.env`, credential/auth/secret files, raw source contents, build
outputs, dependency directories, and symlinks. Detected credential patterns are redacted before the snapshot
reaches the browser. Projects without a safe local checkout still work using Mission Control metadata.

## Privacy and audit behavior

- Raw state is not stored by default.
- Mission Control records a SHA-256 input fingerprint, serialized length, policy snapshot, answers, model
  version, usage, latency, request ID, actor, and timestamps.
- Operators can explicitly retain a maximum 500-character preview for audit context.
- API keys never leave the server and are not returned by status or integration endpoints.
- Provider errors are converted to stable, user-safe codes before storage or display.

## Model management

`jev-latest` follows TypeSafe's stable alias. The resolved model version is recorded on every evaluation.
For calibrated thresholds or release gates, pin a tested version in the policy and re-run the calibration
suite before changing it. Jev accepts text and JSON-compatible state; it does not process image, audio, or
video inputs directly.

Official references:

- <https://docs.typesafe.ai/introduction/quickstart>
- <https://docs.typesafe.ai/sdk/javascript>
- <https://docs.typesafe.ai/api>
- <https://docs.typesafe.ai/models>
