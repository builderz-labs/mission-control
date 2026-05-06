# Workflow Governor v1

## Purpose

The Workflow Governor is an observe-only lifecycle controller for Mission Control. It reads the outputs of all existing Mission Control agents (Preflight, Coordinator, PR Lifecycle Orchestrator, PR Reviewer) and synthesises them into one canonical `next_action` recommendation with approval gates, stop conditions, exact commands, and prompt guidance.

## Why It Exists

Mission Control has nine observe-only bots that each inspect a slice of repo or PR state. None of them are wired together. Before the Governor, the user had to:

1. Run each bot individually
2. Read and interpret every JSON output
3. Manually resolve contradictions (e.g. PR Reviewer flags a pattern that the allowlist should cover)
4. Decide which step to take next
5. Generate the exact git/gh command themselves
6. Know when to stop and ask for help

The Governor reduces this to a single command. It does the synthesis, emits one `next_action`, and generates the exact command to run next.

## What It Does Not Do

- Does **not** write files
- Does **not** commit, push, create PRs, merge, or delete branches
- Does **not** modify git state in any way
- Does **not** automatically execute any gated action
- Does **not** replace the PR Reviewer, Lifecycle Orchestrator, or Coordinator — it reads their output

## Inputs

```
node scripts/workflow-governor.cjs
node scripts/workflow-governor.cjs --repo niko4244/mission-control
node scripts/workflow-governor.cjs --repo niko4244/mission-control --pr 7
node scripts/workflow-governor.cjs --coordinator-report logs/mc/latest.json
```

| Argument | Description |
|---|---|
| `--repo` | GitHub repo in `owner/repo` format. Defaults to `niko4244/mission-control`. |
| `--pr` | PR number to inspect. When provided, runs PR Reviewer with `--skip-validation`. |
| `--coordinator-report` | Path to a saved coordinator JSON report. Skips running the coordinator. |

## Outputs

Emits JSON to stdout. Exits 0 for PASS/WARN, exits 1 only on parse/runtime failure.

```json
{
  "agent": "Workflow Governor v1",
  "label": "OBSERVE ONLY",
  "status": "PASS | WARN | FAIL",
  "risk_level": 0,
  "timestamp": "2026-05-06T21:00:00.000Z",
  "repo": "niko4244/mission-control",
  "repo_state": { ... },
  "branch_state": { ... },
  "pr_state": { ... },
  "validation_state": { ... },
  "bot_results": { ... },
  "contradictions": [],
  "failure_classification": { ... },
  "approval_gates": [],
  "next_action": "idle",
  "next_action_description": "No action required — system is in a stable, clean state",
  "confidence": 0.99,
  "commands": [],
  "prompts": [],
  "stop_conditions": [],
  "notes": [],
  "metadata": { "execution_time_ms": 5000, "log_path": "logs/mc/latest.json" }
}
```

## next_action Enum

| Value | Description |
|---|---|
| `confirm_clean_main` | Checkout main and pull to verify it is clean and up to date |
| `create_branch` | Create a new feature branch from main |
| `inspect_system` | Run coordinator and preflight for a full system snapshot |
| `implement_feature` | Implement the planned feature on the current branch |
| `run_validation` | Run pnpm typecheck, lint, test, and build |
| `commit_changes` | Stage and commit modified files |
| `push_branch` | Push branch to remote and create tracking ref |
| `create_pr` | Open a pull request from the current branch to main |
| `run_pr_reviewer` | Run PR Reviewer to classify risk and run validation suite |
| `classify_blocker` | Investigate production-impacting reviewer findings |
| `patch_feature` | Fix failing tests or implementation before retrying |
| `patch_reviewer` | Update PR Reviewer allowlist for a known false positive |
| `patch_governor` | Update Governor decision logic or failure taxonomy |
| `rerun_validation` | Re-run validation after a fix |
| `merge_pr` | Merge PR using squash strategy — **requires Owner approval** |
| `sync_main_after_merge` | Checkout main and pull to sync the merged commit |
| `stop_human_approval_required` | HALT — ambiguous state requires manual decision |
| `stop_fix_required` | HALT — blocking condition must be resolved first |
| `idle` | No action — system is in a stable, clean state |

## Decision Rules

1. No readable branch → `stop_fix_required`
2. Preflight FAIL → `stop_fix_required`
3. Dirty working tree on main → `stop_fix_required`
4. Dirty working tree on feature branch → `commit_changes`
5. Validation failure (from reviewer steps) → `stop_fix_required`
6. Production-impacting red flags (not allowlisted) → `classify_blocker`
7. PR merge conflict → `stop_fix_required`
8. Reviewer FAIL with production impact → `classify_blocker`
9. PR merged → `sync_main_after_merge`
10. Clean main, no PR → `idle`
11. Feature branch, no tracking → `push_branch`
12. Feature branch ahead of tracking → `push_branch`
13. Pushed branch, no PR → `create_pr`
14. PR open, no reviewer result → `run_pr_reviewer`
15. PR open, reviewer passed, no blocking flags, mergeable → `merge_pr` (gated)
16. Contradictory state → `stop_human_approval_required`

## Approval Gates

The Governor emits an `approval_gates[]` array for any action that is irreversible or externally visible. The gate is always `approval_granted: false` — no action runs automatically.

| Action | Gate Reason |
|---|---|
| `commit_changes` | Alters history — verify staged files and message first |
| `push_branch` | Irreversible without force-push — verify commits first |
| `create_pr` | Visible to collaborators — verify title, body, target |
| `merge_pr` | Irreversible — verify all checks pass and reviewer verdict is SAFE |

Actions that are **never gated** (observe-only, no external side effects):
- `run_pr_reviewer`
- `inspect_system`
- `run_validation`
- `sync_main_after_merge`
- `idle`

## Failure Taxonomy

| Type | Description |
|---|---|
| `real_implementation_blocker` | PR reviewer found a production-impacting pattern that is not allowlisted |
| `validation_failure` | One or more pnpm validation steps (typecheck, test, build) failed |
| `unsafe_mutation_risk` | Shell-execution with production impact detected (e.g. git push in feature code) |
| `reviewer_false_positive` | Shell-execution flagged but allowlisted — observe-only script, no mutation |
| `weak_classifier_rule` | Reviewer rule fired but is too broad for the context |
| `missing_test_coverage` | Systems Curator detected implementation gaps in documentation or tests |
| `dirty_working_tree` | Uncommitted changes present — working tree is not clean |
| `branch_tracking_issue` | Branch has no upstream tracking ref or is ahead of remote |
| `pr_state_issue` | PR is closed without merging, or in an unexpected state |
| `mergeability_issue` | PR has merge conflicts that must be resolved |
| `stale_main` | main is behind remote — needs a pull |
| `dependency_tooling_issue` | node, pnpm, git, or gh is unavailable or misconfigured |
| `shell_environment_issue` | Environment variable or shell configuration is unsafe |
| `ambiguous_state` | Two or more agents disagree and the Governor cannot resolve the conflict |

## Contradiction Detection

The Governor detects these contradiction patterns:

| Kind | Trigger | Resolution |
|---|---|---|
| `flag_allowlisted` | PR Reviewer flags shell-execution but `allowed: true` | Resolved — recorded as false positive, `resolved_severity: info` |
| `agent_disagreement` | Orchestrator says tree is clean, Preflight says dirty | Unresolved — treats as dirty (conservative) |
| `stale_recommendation` | Orchestrator recommends `push_branch` but PR already exists | Resolved — skip push, proceed to `run_pr_reviewer` |

Unresolved contradictions lower the `confidence` score. Resolved contradictions contribute `+0.01` to confidence.

## Example Output — clean main

```json
{
  "agent": "Workflow Governor v1",
  "label": "OBSERVE ONLY",
  "status": "PASS",
  "risk_level": 0,
  "next_action": "idle",
  "next_action_description": "No action required — system is in a stable, clean state",
  "confidence": 0.99,
  "commands": ["node scripts/workflow-governor.cjs --repo niko4244/mission-control"],
  "approval_gates": [],
  "stop_conditions": [],
  "notes": ["main is clean with no active PR — system is idle"]
}
```

## Example Output — PR ready to merge

```json
{
  "agent": "Workflow Governor v1",
  "label": "OBSERVE ONLY",
  "status": "WARN",
  "risk_level": 1,
  "next_action": "merge_pr",
  "next_action_description": "Merge PR using squash strategy — requires Owner approval",
  "confidence": 0.92,
  "commands": ["gh pr merge 7 --repo niko4244/mission-control --squash --delete-branch"],
  "approval_gates": [{
    "gate_id": "merge_pr_gate",
    "action": "merge_pr",
    "approval_required": true,
    "approval_granted": false,
    "authority": "Owner (nik.marconcini@gmail.com)"
  }],
  "stop_conditions": [],
  "notes": ["PR #7 passes all checks — ready to merge (approval required)"]
}
```

## Running the Governor

```bash
# Basic run (no PR)
node scripts/workflow-governor.cjs --repo niko4244/mission-control

# With PR context
node scripts/workflow-governor.cjs --repo niko4244/mission-control --pr 7

# From saved coordinator report
node scripts/workflow-governor.cjs --coordinator-report logs/mc/latest.json

# Via package.json script
pnpm govern:workflow
```

## Architecture

```
workflow-governor.cjs
  ├── gatherBotResults()
  │     ├── runChildScript(mission-control-preflight.cjs)
  │     ├── runChildScript(mc-coordinator.cjs) | read coordinatorReport file
  │     ├── runChildScript(pr-lifecycle-orchestrator.cjs [--pr N])
  │     └── runChildScript(pr-reviewer.cjs --pr N --skip-validation)  [if --pr provided]
  ├── extractRepoState()        — normalise branch/tree state from bot outputs
  ├── extractBranchState()      — tracking/ahead/behind from orchestrator
  ├── extractPrState()          — PR number/state/mergeable from orchestrator + reviewer
  ├── extractValidationState()  — typecheck/test/build pass/fail from reviewer
  ├── detectContradictions()    — flag_allowlisted, agent_disagreement, stale_recommendation
  ├── classifyFailures()        — real_blockers, false_positives, implementation_gaps
  ├── decide()                  — emit one next_action from the enum
  ├── buildCommands()           — exact PowerShell-safe commands for next_action
  ├── buildPrompts()            — human-readable next step with acceptance criteria
  ├── buildApprovalGates()      — gated actions: push, create_pr, commit, merge
  └── computeStatusRisk()       — PASS/WARN/FAIL + risk_level 0–3
```
