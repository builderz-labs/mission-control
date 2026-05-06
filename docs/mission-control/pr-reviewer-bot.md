# PR Reviewer Bot

**Version**: 1.0.0
**Status**: ACTIVE — present in `data/mission-control/agent-registry.json` with `enabled: false`. Invoked manually via CLI. Not coordinator-orchestrated (requires `--repo` and `--pr` arguments).

---

## Overview

PR Reviewer Bot v1 is an observe-only Mission Control agent that automates PR review, validation, risk classification, and reviewer comment generation. It never merges, commits, pushes, or modifies any file.

---

## Usage

```bash
# Review a PR (produces JSON + Markdown comment)
node scripts/pr-reviewer.cjs --repo owner/repo --pr 123

# Review and print comment to stdout (or post it if gh is authenticated)
node scripts/pr-reviewer.cjs --repo owner/repo --pr 123 --post-comment

# pnpm shorthand
pnpm pr:review -- --repo owner/repo --pr 123
```

---

## Behavior

1. **Fetch PR metadata** — uses `gh pr view` if the gh CLI is available and authenticated; falls back to the GitHub public REST API (unauthenticated, 60 req/hr limit).
2. **Fetch changed files** — `gh pr view --json files` or `GET /repos/{owner}/{repo}/pulls/{number}/files`.
3. **Fetch diff** — prefers local git diff by fetching the PR base/head refs and diffing the fetched SHAs; falls back to `gh pr diff` if local git cannot resolve the diff.
4. **Classify files by risk**:
   - **High**: `scripts/`, `src/app/api/`, `package.json`, `pnpm-lock.yaml`, `data/mission-control/agent-registry.json`, auth/middleware files
   - **Medium**: `src/lib/`, YAML/Docker config
   - **Low**: `src/components/`, test files, docs
5. **Classify finding context**:
   - **production**: runtime scripts, routes, libraries, shipped application code
   - **config**: dependency/config/env/infra files that can change runtime posture
   - **test**: `src/lib/__tests__/`, `*.test.*`, `*.spec.*`
   - **docs**: `docs/**`, Markdown examples
   - **tooling/reviewer-self**: reviewer implementation and detector catalog
6. **Scan diff for red flags**:
   - `dynamic-execution` (critical): `eval()`, `new Function()`
   - `auth-bypass` (critical): skipAuth, isAuthenticated === false
   - `approval-bypass` (critical): skipApproval, auto-approve, skip-gate
   - `secrets-in-code` (critical): hardcoded keys/tokens/passwords
   - `filesystem-mutation` (high): `fs.unlinkSync`, `fs.rmSync`, `fs.writeFileSync`
   - `shell-execution` (high): `execSync`, `spawnSync`, `child_process`
   - `default-allow` (high): defaultAllow, allowAll
   - `network-call` (medium): fetch, axios, https.get
   - `new-dependency` (medium): new package added to package.json
   - `tests-removed` (medium): test files deleted from diff
   - Each finding records `flag`, `severity`, `path`, `line`, `context_type`, `production_impact`, and `message`
   - Test fixtures, docs examples, and the reviewer’s own static detector catalog are reported as non-production findings by default
   - `shell-execution` can be allowlisted only for narrow local Mission Control patterns when all are true:
     - file path is explicitly allowlisted
     - command is bounded/known or drawn from a controlled candidate list
     - timeout is present
     - stdio is piped or ignored, never inherited interactive shell
     - no user-provided arbitrary command string is executed directly
     - behavior is local preflight, validation, or observe-only orchestration
   - Current shell-execution allowlist is intentionally narrow:
     - `scripts/mission-control-preflight.cjs`
     - `scripts/mc-coordinator.cjs`
   - API routes, approval paths, bot execution paths, and arbitrary scripts are never allowlisted by default
7. **Run local validation suite**:
   - `pnpm typecheck`
   - `pnpm test --run`
   - `pnpm build`
   - `node scripts/systems-curator.cjs`
   - `node scripts/mc-coordinator.cjs`
8. **Compute verdict**:
   - **BLOCK** only for production-impacting high/critical red flags, validation failures, or missing diff data
   - **SAFE WITH NOTES** for non-production findings (tests/docs/tooling fixtures) when validation passes
   - **LGTM** when no production-impacting issues are detected
9. **Emit structured JSON** to stdout.
10. **Generate Markdown reviewer comment** with separate sections for:
    - Production red flags
    - Allowed local command execution findings
    - Non-production/Test fixture findings
    - Validation results
    - Merge verdict
11. **Optionally post comment** via `--post-comment` flag:
    - If gh is authenticated: posts via `gh pr comment`
    - If gh is unavailable or unauthenticated: prints fallback to `comment_posted.reason`, comment text is in `markdown_comment`

---

## Safety Constraints

| Constraint | Value |
|---|---|
| `observe_only` | `true` |
| Merge capable | **No** — `--merge` and `--auto-merge` are refused with exit code 1 |
| Commit capable | No |
| Push capable | No |
| File mutation | None — reads only |
| Secrets in output | None — env vars are never logged |
| Auto-approve | Never |

Passing `--merge` or `--auto-merge` immediately exits 1 with a structured JSON refusal. This cannot be overridden.

---

## Output Format

```json
{
  "agent": "PR Reviewer Bot v1",
  "label": "OBSERVE ONLY",
  "status": "OK | WARN | FAIL",
  "risk_level": 0,
  "timestamp": "ISO8601",
  "pr": { "repo": "owner/repo", "number": 123 },
  "meta_source": "gh-cli | github-api | none",
  "diff_source": "local-git | gh-cli | none",
  "pr_meta": { "title": "...", "state": "open", "additions": 10, "deletions": 2, ... },
  "file_summary": {
    "total": 5,
    "files": [{ "path": "scripts/foo.cjs", "risk": "high", "category": "scripts", "strict_zone": true }],
    "high_risk_count": 1, "medium_risk_count": 2, "low_risk_count": 2
  },
  "red_flags": [
    {
      "flag": "dynamic-execution",
      "severity": "critical",
      "path": "src/app/api/example/route.ts",
      "line": 18,
      "context_type": "production",
      "production_impact": true,
      "allowed": false,
      "allow_reason": null,
      "requires_human_review": true,
      "message": "dynamic-execution pattern matched in production code at src/app/api/example/route.ts:18",
      "excerpt": "const result = eval(userInput);"
    }
  ],
  "validation": {
    "passed": true,
    "skipped": false,
    "steps": [
      { "step": "typecheck", "passed": true, "duration_ms": 8000 },
      { "step": "test", "passed": true, "duration_ms": 45000 },
      { "step": "build", "passed": true, "duration_ms": 30000 },
      { "step": "systems-curator", "passed": true, "duration_ms": 2000 },
      { "step": "mc-coordinator", "passed": true, "duration_ms": 5000 }
    ]
  },
  "verdict": {
    "status": "WARN",
    "risk_level": 1,
    "recommendation": "SAFE WITH NOTES — no production-impacting red flags detected",
    "reasons": ["2 non-production finding(s): dynamic-execution (1), shell-execution (1)"]
  },
  "warnings": ["..."],
  "recommended_next_actions": ["SAFE WITH NOTES — no production-impacting red flags detected"],
  "safety": { "observe_only": true, "merge_capable": false, "commit_capable": false, "push_capable": false },
  "markdown_comment": "## 🟡 PR Review — Mission Control Bot..."
}
```

---

## Risk Levels

| Level | Status | Trigger |
|---|---|---|
| 0 | OK | No production-impacting issues detected and validation passed |
| 1 | WARN | Non-production/test fixture findings, allowlisted local execution findings, or high-risk file changes without production-impacting red flags |
| 2 | FAIL | Production-impacting high-severity red flags |
| 3 | FAIL | Production-impacting critical red flags, validation failure, or missing diff |

---

## Registry Entry

```json
{
  "id": "pr-reviewer-bot",
  "name": "PR Reviewer Bot",
  "status": "ACTIVE",
  "mode": "OBSERVE_ONLY",
  "enabled": false,
  "observe_only": true
}
```

`enabled: false` because the bot requires `--repo` and `--pr` arguments that the coordinator cannot supply. It is invoked manually or via CI.

---

## Known Limitations

- Public GitHub API metadata is enough to attempt local-git diff fetches, but fork-only or deleted head refs can still leave `diff_source: "none"` and trigger an incomplete blocking review.
- Validation runs the full test suite (~45s) and full build (~30s) — expect 90–120s total runtime.
- GitHub public API is rate-limited at 60 requests/hour unauthenticated.
- `--post-comment` only posts when gh is authenticated; otherwise it is a no-op (comment is always available in the JSON output).
