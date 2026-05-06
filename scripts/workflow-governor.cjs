#!/usr/bin/env node
/**
 * workflow-governor.cjs — Workflow Governor v1
 * Observe-only lifecycle controller for Mission Control.
 *
 * Reads outputs from existing Mission Control agents (preflight, coordinator,
 * lifecycle-orchestrator, pr-reviewer), synthesises them into one canonical
 * next_action, emits approval gates and exact commands for every gated step.
 *
 * Never writes files, mutates git state, commits, pushes, creates PRs,
 * merges, or deletes branches.  Safe to run repeatedly.
 *
 * Exits 0 for PASS/WARN. Exits 1 only on runtime/parse failure.
 *
 * Usage:
 *   node scripts/workflow-governor.cjs
 *   node scripts/workflow-governor.cjs --repo niko4244/mission-control
 *   node scripts/workflow-governor.cjs --repo niko4244/mission-control --pr 7
 *   node scripts/workflow-governor.cjs --coordinator-report logs/mc/latest.json
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AGENT  = 'Workflow Governor v1';
const LABEL  = 'OBSERVE ONLY';
const ROOT   = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'niko4244/mission-control';

// ── next_action enum ──────────────────────────────────────────────────────────

const NEXT_ACTIONS = /** @type {const} */ ([
  'confirm_clean_main',
  'create_branch',
  'inspect_system',
  'implement_feature',
  'run_validation',
  'commit_changes',
  'push_branch',
  'create_pr',
  'run_pr_reviewer',
  'classify_blocker',
  'patch_feature',
  'patch_reviewer',
  'patch_governor',
  'rerun_validation',
  'merge_pr',
  'sync_main_after_merge',
  'stop_human_approval_required',
  'stop_fix_required',
  'idle',
]);

// ── Failure classification types ──────────────────────────────────────────────

const FAILURE_TYPES = /** @type {const} */ ([
  'real_implementation_blocker',
  'validation_failure',
  'unsafe_mutation_risk',
  'reviewer_false_positive',
  'weak_classifier_rule',
  'missing_test_coverage',
  'dirty_working_tree',
  'branch_tracking_issue',
  'pr_state_issue',
  'mergeability_issue',
  'stale_main',
  'dependency_tooling_issue',
  'shell_environment_issue',
  'ambiguous_state',
]);

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    pr: null,
    coordinatorReport: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo')                args.repo = argv[++i] ?? DEFAULT_REPO;
    else if (a === '--pr')             args.pr = Number(argv[++i]) || null;
    else if (a === '--coordinator-report') args.coordinatorReport = argv[++i] ?? null;
  }
  return args;
}

// ── Child-script runner (observe-only) ───────────────────────────────────────

function runChildScript(scriptArgs, timeoutMs = 90000) {
  const result = spawnSync('node', scriptArgs, {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });

  if (result.error) {
    return { ok: false, data: null, error: result.error.message };
  }
  if (result.status !== 0) {
    const raw = (result.stderr || result.stdout || '').trim().slice(0, 500);
    // Try to parse stderr JSON (some scripts emit structured errors there)
    try { return { ok: false, data: JSON.parse(raw), error: null }; } catch { /* ignore */ }
    return { ok: false, data: null, error: raw || `exit ${result.status}` };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout), error: null };
  } catch {
    return { ok: false, data: null, error: 'JSON parse failed on child stdout' };
  }
}

// ── Gather bot results ────────────────────────────────────────────────────────

function gatherBotResults(args) {
  const results = {};

  // 1. Preflight
  const preflightRes = runChildScript(
    [path.join(ROOT, 'scripts', 'mission-control-preflight.cjs')],
    30000
  );
  results['mission-control-preflight'] = preflightRes.ok
    ? preflightRes.data
    : { status: 'FAIL', risk_level: 3, error: preflightRes.error };

  // 2. Coordinator (may be pre-loaded from file)
  if (args.coordinatorReport) {
    try {
      results['mc-coordinator'] = JSON.parse(
        fs.readFileSync(args.coordinatorReport, 'utf-8')
      );
    } catch (e) {
      results['mc-coordinator'] = { status: 'FAIL', risk_level: 3, error: `Cannot read coordinator report: ${e.message}` };
    }
  } else {
    const coordRes = runChildScript(
      [path.join(ROOT, 'scripts', 'mc-coordinator.cjs')],
      120000
    );
    results['mc-coordinator'] = coordRes.ok
      ? coordRes.data
      : { status: 'FAIL', risk_level: 3, error: coordRes.error };
  }

  // 3. Lifecycle orchestrator
  const orchArgs = [path.join(ROOT, 'scripts', 'pr-lifecycle-orchestrator.cjs'), '--repo', args.repo];
  if (args.pr) orchArgs.push('--pr', String(args.pr));
  const orchRes = runChildScript(orchArgs, 30000);
  results['pr-lifecycle-orchestrator'] = orchRes.ok
    ? orchRes.data
    : { status: 'FAIL', risk_level: 3, error: orchRes.error };

  // 4. PR Reviewer (only when PR number provided)
  if (args.pr) {
    const reviewerRes = runChildScript(
      [
        path.join(ROOT, 'scripts', 'pr-reviewer.cjs'),
        '--repo', args.repo,
        '--pr', String(args.pr),
        '--skip-validation',
      ],
      120000
    );
    results['pr-reviewer'] = reviewerRes.ok
      ? reviewerRes.data
      : { status: 'FAIL', risk_level: 3, error: reviewerRes.error };
  }

  return results;
}

// ── Extract normalised state ──────────────────────────────────────────────────

function extractRepoState(botResults) {
  const preflight = botResults['mission-control-preflight'] || {};
  const orch      = botResults['pr-lifecycle-orchestrator'] || {};

  const git = preflight.git || {};
  const branch = orch.branch || {};

  return {
    root:                path.resolve(ROOT),
    branch_current:      branch.current  ?? git.branch  ?? null,
    is_main:             branch.is_main  ?? false,
    working_tree_clean:  branch.working_tree_clean ?? git.is_clean ?? null,
    status_short:        git.status_short ?? [],
    ahead_of_upstream:   branch.ahead    ?? null,
    behind_upstream:     branch.behind   ?? null,
    tracking_ref:        branch.tracking ?? null,
  };
}

function extractBranchState(botResults) {
  const orch = botResults['pr-lifecycle-orchestrator'] || {};
  return orch.branch || {
    current: null,
    is_main: false,
    tracking: null,
    ahead: null,
    behind: null,
    working_tree_clean: null,
  };
}

function extractPrState(botResults, prArg) {
  const orch = botResults['pr-lifecycle-orchestrator'] || {};
  const reviewer = botResults['pr-reviewer'] || {};
  const orchPr = orch.pr || {};
  const reviewerMeta = reviewer.pr_meta || {};

  return {
    number:        orchPr.number     ?? reviewerMeta.number     ?? prArg   ?? null,
    state:         orchPr.state      ?? reviewerMeta.state      ?? null,
    base:          orchPr.base       ?? reviewerMeta.baseRefName ?? null,
    head:          orchPr.head       ?? reviewerMeta.headRefName ?? null,
    mergeable:     orchPr.mergeable  ?? reviewerMeta.mergeable  ?? null,
    changed_files: orchPr.changed_files ?? reviewerMeta.changedFiles ?? null,
  };
}

function extractValidationState(botResults) {
  const reviewer = botResults['pr-reviewer'] || {};
  const validation = reviewer.validation || {};
  const steps = validation.steps || [];

  const stepMap = {};
  for (const s of steps) stepMap[s.step] = s.passed;

  const preflight = botResults['mission-control-preflight'] || {};
  const preflightPass = preflight.status === 'PASS' || preflight.status === 'WARN';

  return {
    preflight_passed:      preflightPass,
    pnpm_typecheck_passed: stepMap['typecheck'] ?? null,
    pnpm_test_passed:      stepMap['test']      ?? null,
    pnpm_build_passed:     stepMap['build']     ?? null,
    all_validations_passed: (
      preflightPass &&
      (stepMap['typecheck'] !== false) &&
      (stepMap['test']      !== false) &&
      (stepMap['build']     !== false)
    ),
  };
}

// ── Contradiction detection ───────────────────────────────────────────────────

function detectContradictions(botResults, repoState) {
  const contradictions = [];

  const reviewer  = botResults['pr-reviewer'] || {};
  const orch      = botResults['pr-lifecycle-orchestrator'] || {};
  const preflight = botResults['mission-control-preflight'] || {};

  // 1. Shell-execution findings that are allowlisted
  const redFlags = reviewer.red_flags || [];
  for (const flag of redFlags) {
    if (flag.flag === 'shell-execution' && flag.allowed === true) {
      contradictions.push({
        kind: 'flag_allowlisted',
        agent_flagged: 'pr-reviewer',
        flag: flag.flag,
        path: flag.path,
        line: flag.line,
        initial_severity: flag.severity,
        resolution: flag.allow_reason || 'Matched observe-only allowlist — no mutation commands detected',
        resolved_severity: 'info',
        production_impact: false,
        confidence: 0.95,
      });
    }
  }

  // 2. Orchestrator says clean but preflight says dirty
  const orchClean  = orch.branch && orch.branch.working_tree_clean === true;
  const pfDirty    = preflight.git && preflight.git.is_clean === false;
  if (orchClean && pfDirty) {
    contradictions.push({
      kind: 'agent_disagreement',
      agents: ['pr-lifecycle-orchestrator', 'mission-control-preflight'],
      topic: 'working_tree_clean',
      values: { 'pr-lifecycle-orchestrator': true, 'mission-control-preflight': false },
      resolution: 'Preflight runs at script start; orchestrator may run slightly later. Treating as dirty.',
      confidence: 0.80,
    });
  }

  // 3. Orchestrator says push_branch but PR already exists
  const orchAction = orch.next_action;
  const prState    = reviewer.pr_meta && reviewer.pr_meta.state;
  if (orchAction === 'push_branch' && prState === 'OPEN') {
    contradictions.push({
      kind: 'stale_recommendation',
      agent: 'pr-lifecycle-orchestrator',
      recommendation: 'push_branch',
      observed_reality: 'PR is already OPEN',
      resolution: 'PR exists — skip push_branch, proceed to run_pr_reviewer.',
      confidence: 0.90,
    });
  }

  return contradictions;
}

// ── Failure classification ─────────────────────────────────────────────────────

function classifyFailures(botResults, repoState, prState, contradictions) {
  const real_blockers        = [];
  const false_positives      = [];
  const implementation_gaps  = [];
  const transient_failures   = [];

  const reviewer  = botResults['pr-reviewer'] || {};
  const preflight = botResults['mission-control-preflight'] || {};
  const coord     = botResults['mc-coordinator'] || {};

  // Preflight failures
  if (preflight.status === 'FAIL') {
    for (const f of (preflight.failures || [])) {
      real_blockers.push({ type: 'shell_environment_issue', source: 'mission-control-preflight', message: f });
    }
  }

  // Dirty main
  if (repoState.is_main && repoState.working_tree_clean === false) {
    real_blockers.push({
      type: 'dirty_working_tree',
      source: 'repo_state',
      message: 'Working tree is dirty on main — commit or stash before continuing',
    });
  }

  // PR merge conflict
  if (prState.mergeable === 'CONFLICTING') {
    real_blockers.push({
      type: 'mergeability_issue',
      source: 'pr-lifecycle-orchestrator',
      message: `PR #${prState.number} has merge conflicts`,
    });
  }

  // Reviewer red flags — separate production-impacting from allowlisted
  const redFlags = reviewer.red_flags || [];
  for (const flag of redFlags) {
    if (flag.production_impact === true && !flag.allowed) {
      const type = flag.flag === 'shell-execution' ? 'unsafe_mutation_risk' : 'real_implementation_blocker';
      real_blockers.push({
        type,
        source: 'pr-reviewer',
        path: flag.path,
        flag: flag.flag,
        severity: flag.severity,
        message: flag.message,
      });
    } else if (flag.allowed === true) {
      // Counted in contradictions already — mark as false positive
      false_positives.push({
        type: 'reviewer_false_positive',
        source: 'pr-reviewer',
        path: flag.path,
        flag: flag.flag,
        allow_reason: flag.allow_reason,
      });
    }
  }

  // Validation failures
  const validation = reviewer.validation || {};
  for (const step of (validation.steps || [])) {
    if (!step.passed) {
      real_blockers.push({
        type: 'validation_failure',
        source: 'pr-reviewer',
        step: step.step,
        message: `Validation step '${step.step}' failed`,
      });
    }
  }

  // Coordinator child failures
  const coordAgents = (coord.agents) ? Object.entries(coord.agents) : [];
  for (const [agentId, agentResult] of coordAgents) {
    if (agentResult && agentResult.status === 'FAIL') {
      real_blockers.push({
        type: 'shell_environment_issue',
        source: `mc-coordinator/${agentId}`,
        message: agentResult.error || `Agent ${agentId} failed`,
      });
    }
  }

  // Implementation gaps from systems curator
  const curatorResult = (coord.agents || {})['systems-curator'] || {};
  const gaps = curatorResult.implementation_gaps || [];
  for (const gap of gaps) {
    implementation_gaps.push({
      type: 'missing_test_coverage',
      source: 'systems-curator',
      message: typeof gap === 'string' ? gap : JSON.stringify(gap),
    });
  }

  // Bot script failures (governor's own child runs)
  for (const [botId, botResult] of Object.entries(botResults)) {
    if (botResult && botResult.error && !botResult.status) {
      transient_failures.push({
        type: 'shell_environment_issue',
        source: botId,
        message: botResult.error,
      });
    }
  }

  return {
    real_blockers,
    false_positives,
    implementation_gaps,
    contradictions: contradictions.length,
    transient_failures,
  };
}

// ── Approval gates ────────────────────────────────────────────────────────────

function buildApprovalGates(nextAction, prState) {
  const gates = [];

  const gatedActions = new Set([
    'push_branch',
    'create_pr',
    'merge_pr',
    'commit_changes',
  ]);

  if (!gatedActions.has(nextAction)) return gates;

  const reasons = {
    push_branch:    'Pushing to remote is irreversible without force-push — verify branch and commits first',
    create_pr:      'Opening a PR is visible to collaborators — verify title, body, and target branch first',
    merge_pr:       'Merging is irreversible — verify all checks pass and reviewer verdict is SAFE',
    commit_changes: 'Committing changes alters history — verify staged files and message first',
  };

  gates.push({
    gate_id:          `${nextAction}_gate`,
    action:           nextAction,
    status:           'READY',
    reason:           reasons[nextAction] || `${nextAction} requires explicit approval`,
    approval_required: true,
    approval_granted: false,
    authority:        'Owner (nik.marconcini@gmail.com)',
    approval_expires_at: null,
  });

  return gates;
}

// ── Decision engine ───────────────────────────────────────────────────────────

function decide(repoState, branchState, prState, validationState, botResults, failureClassification, contradictions) {
  const stopConditions = [];
  const notes          = [];

  const reviewer  = botResults['pr-reviewer'] || {};
  const orch      = botResults['pr-lifecycle-orchestrator'] || {};

  // 1. No branch — detached HEAD or unreadable git
  if (!repoState.branch_current) {
    stopConditions.push('Cannot determine current branch — git may be in detached HEAD state');
    return { next_action: 'stop_fix_required', stopConditions, notes, confidence: 0.99 };
  }

  // 2. Hard blockers from preflight
  const preflight = botResults['mission-control-preflight'] || {};
  if (preflight.status === 'FAIL') {
    stopConditions.push(...(preflight.failures || ['Preflight failed — check tool availability']));
    return { next_action: 'stop_fix_required', stopConditions, notes, confidence: 0.99 };
  }

  // 3. Dirty working tree on main
  if (repoState.is_main && repoState.working_tree_clean === false) {
    stopConditions.push('Working tree is dirty on main — commit or stash before continuing');
    return { next_action: 'stop_fix_required', stopConditions, notes, confidence: 0.99 };
  }

  // 4. Dirty working tree on feature branch
  if (!repoState.is_main && repoState.working_tree_clean === false) {
    notes.push('Working tree has uncommitted changes — stage and commit before pushing');
    return { next_action: 'commit_changes', stopConditions, notes, confidence: 0.95 };
  }

  // 5. Real validation failures (from reviewer validation steps)
  const hasValidationFailure = failureClassification.real_blockers.some(
    b => b.type === 'validation_failure'
  );
  if (hasValidationFailure) {
    stopConditions.push(...failureClassification.real_blockers
      .filter(b => b.type === 'validation_failure')
      .map(b => b.message));
    notes.push('Fix failing validation steps before proceeding');
    return { next_action: 'stop_fix_required', stopConditions, notes, confidence: 0.98 };
  }

  // 6. Production-impacting red flags (not allowlisted)
  const hasMutationRisk = failureClassification.real_blockers.some(
    b => b.type === 'unsafe_mutation_risk' || b.type === 'real_implementation_blocker'
  );
  if (hasMutationRisk) {
    stopConditions.push(...failureClassification.real_blockers
      .filter(b => b.type === 'unsafe_mutation_risk' || b.type === 'real_implementation_blocker')
      .map(b => b.message));
    return { next_action: 'classify_blocker', stopConditions, notes, confidence: 0.95 };
  }

  // 7. Merge conflicts
  if (prState.mergeable === 'CONFLICTING') {
    stopConditions.push(`PR #${prState.number} has merge conflicts — resolve before merging`);
    return { next_action: 'stop_fix_required', stopConditions, notes, confidence: 0.99 };
  }

  // 8. PR reviewer block with ONLY reviewer_false_positive (all flags are allowlisted)
  const reviewerVerdict = reviewer.verdict;
  const reviewerStatus  = reviewerVerdict ? reviewerVerdict.status : null;
  const onlyFalsePositives = (
    failureClassification.real_blockers.length === 0 &&
    failureClassification.false_positives.length > 0
  );
  if (reviewerStatus === 'WARN' && onlyFalsePositives) {
    notes.push('Reviewer flags are all allowlisted observe-only patterns — non-blocking');
  }

  // 9. Reviewer returned FAIL/BLOCK with production impact
  if (reviewerStatus === 'FAIL' && failureClassification.real_blockers.length > 0) {
    stopConditions.push('PR Reviewer returned FAIL with production-impacting findings');
    return { next_action: 'classify_blocker', stopConditions, notes, confidence: 0.96 };
  }

  // 10. Clean main, no PR → idle
  if (repoState.is_main && repoState.working_tree_clean) {
    if (!prState.number) {
      notes.push('main is clean with no active PR — system is idle');
      return { next_action: 'idle', stopConditions, notes, confidence: 0.99 };
    }
    if (prState.state === 'MERGED') {
      notes.push(`PR #${prState.number} is merged — sync main`);
      return { next_action: 'sync_main_after_merge', stopConditions, notes, confidence: 0.99 };
    }
  }

  // 11. PR already merged
  if (prState.state === 'MERGED') {
    notes.push(`PR #${prState.number} is already merged — sync main`);
    return { next_action: 'sync_main_after_merge', stopConditions, notes, confidence: 0.99 };
  }

  // 12. Feature branch, no tracking ref
  if (!repoState.is_main && !branchState.tracking) {
    notes.push('Branch has no upstream tracking ref — push to create it');
    return { next_action: 'push_branch', stopConditions, notes, confidence: 0.98 };
  }

  // 13. Feature branch ahead of tracking (unpushed commits)
  if (!repoState.is_main && branchState.ahead !== null && branchState.ahead > 0) {
    notes.push(`Branch is ${branchState.ahead} commit(s) ahead of ${branchState.tracking} — push before opening PR`);
    return { next_action: 'push_branch', stopConditions, notes, confidence: 0.97 };
  }

  // 14. Pushed branch, no PR
  if (!repoState.is_main && branchState.tracking && !prState.number) {
    notes.push('Branch is pushed and clean — ready to open a PR');
    return { next_action: 'create_pr', stopConditions, notes, confidence: 0.92 };
  }

  // 15. PR open — reviewer not yet run or validation result not present
  const reviewerHasRun = !!reviewer.verdict;
  if (prState.state === 'OPEN' && !reviewerHasRun) {
    notes.push(`PR #${prState.number} is open — run reviewer before merge decision`);
    return { next_action: 'run_pr_reviewer', stopConditions, notes, confidence: 0.97 };
  }

  // 16. PR open, validation passing, no production flags, mergeable → merge gate
  if (
    prState.state === 'OPEN' &&
    reviewerHasRun &&
    validationState.all_validations_passed !== false &&
    failureClassification.real_blockers.length === 0 &&
    (prState.mergeable === 'MERGEABLE' || prState.mergeable === 'UNKNOWN')
  ) {
    notes.push(`PR #${prState.number} passes all checks — ready to merge (approval required)`);
    return { next_action: 'merge_pr', stopConditions, notes, confidence: adjustConfidence(0.92, contradictions) };
  }

  // 17. Lifecycle orchestrator has a recommendation we can defer to
  if (orch.next_action && orch.next_action !== 'stop_fix_required') {
    notes.push(`Deferring to lifecycle orchestrator recommendation: ${orch.next_action}`);
    return { next_action: orch.next_action, stopConditions, notes, confidence: 0.75 };
  }

  // 18. Ambiguous state
  notes.push('State is ambiguous — manual inspection recommended');
  return { next_action: 'stop_human_approval_required', stopConditions, notes, confidence: 0.50 };
}

function adjustConfidence(base, contradictions) {
  const resolved = contradictions.filter(c => c.resolved_severity === 'info').length;
  const unresolved = contradictions.filter(c => !c.resolved_severity || c.resolved_severity !== 'info').length;
  return Math.max(0.5, base - (unresolved * 0.05) + (resolved * 0.01));
}

// ── Command generator ─────────────────────────────────────────────────────────

function buildCommands(nextAction, repoState, prState, repo) {
  const branch = repoState.branch_current || '<branch>';
  const prNum  = prState.number;

  switch (nextAction) {
    case 'confirm_clean_main':
      return [
        'git checkout main',
        'git pull niko main',
        'git status --short',
        'git log --oneline -5',
      ];

    case 'create_branch':
      return ['git checkout -b <new-branch-name>'];

    case 'inspect_system':
      return [
        'node scripts/mc-coordinator.cjs',
        'node scripts/mission-control-preflight.cjs',
      ];

    case 'run_validation':
      return [
        'pnpm typecheck',
        'pnpm lint',
        'pnpm test --run',
        'pnpm build',
      ];

    case 'rerun_validation':
      return [
        'pnpm typecheck',
        'pnpm test --run',
        'pnpm build',
        'node scripts/mc-coordinator.cjs',
      ];

    case 'commit_changes':
      return [
        'git status --short',
        'git diff',
        'git add <file1> <file2>',
        'git commit -m "type(scope): description"',
      ];

    case 'push_branch':
      return [`git push -u niko ${branch}`];

    case 'create_pr':
      return [
        `gh pr create --repo ${repo} --base main --head ${branch} --title "<title>" --body "<body>"`,
      ];

    case 'run_pr_reviewer':
      return prNum
        ? [`node scripts/pr-reviewer.cjs --repo ${repo} --pr ${prNum}`]
        : [`node scripts/pr-reviewer.cjs --repo ${repo} --pr <PR_NUMBER>`];

    case 'merge_pr':
      return prNum
        ? [`gh pr merge ${prNum} --repo ${repo} --squash --delete-branch`]
        : [`gh pr merge <PR_NUMBER> --repo ${repo} --squash --delete-branch`];

    case 'sync_main_after_merge':
      return [
        'git checkout main',
        'git pull niko main',
        'git status --short',
        'git log --oneline -5',
      ];

    case 'classify_blocker':
      return [
        prNum
          ? `node scripts/pr-reviewer.cjs --repo ${repo} --pr ${prNum}`
          : `node scripts/pr-reviewer.cjs --repo ${repo} --pr <PR_NUMBER>`,
        'node scripts/mc-coordinator.cjs',
      ];

    case 'patch_feature':
      return [
        'pnpm typecheck',
        'pnpm test --run',
        'git diff',
      ];

    case 'patch_reviewer':
      return [
        'node scripts/pr-reviewer.cjs --repo ' + repo + (prNum ? ` --pr ${prNum}` : ' --pr <PR_NUMBER>'),
        'pnpm test --run src/lib/__tests__/pr-reviewer-bot.test.ts',
      ];

    case 'patch_governor':
      return [
        'node scripts/workflow-governor.cjs --repo ' + repo + (prNum ? ` --pr ${prNum}` : ''),
        'pnpm test --run src/lib/__tests__/workflow-governor.test.ts',
      ];

    case 'implement_feature':
      return [
        'git checkout -b <feature-branch>',
        'pnpm typecheck',
        'pnpm test --run',
      ];

    case 'stop_human_approval_required':
    case 'stop_fix_required':
      return [
        'git status --short',
        'git diff',
        'node scripts/mission-control-preflight.cjs',
      ];

    case 'idle':
    default:
      return [
        'node scripts/workflow-governor.cjs --repo ' + repo,
        'node scripts/mc-coordinator.cjs',
      ];
  }
}

// ── Prompt generator ──────────────────────────────────────────────────────────

function buildPrompts(nextAction, repoState, prState, repo) {
  const prNum = prState.number;

  const promptMap = {
    commit_changes: {
      step: 1,
      prompt: 'Stage and commit the modified files. Use specific file paths only — never git add . Stage only the files related to this change.',
      approval_required: true,
      acceptance_criteria: ['git status is clean after commit', 'commit message follows Conventional Commits format'],
    },
    push_branch: {
      step: 1,
      prompt: `Push branch '${repoState.branch_current || '<branch>'}' to origin with tracking ref. Do not force-push.`,
      approval_required: true,
      acceptance_criteria: ['branch appears on remote', 'no error from git push', 'tracking ref set'],
    },
    create_pr: {
      step: 1,
      prompt: `Create a PR from '${repoState.branch_current || '<branch>'}' to main on ${repo}. Include a descriptive title and body summarising the change.`,
      approval_required: true,
      acceptance_criteria: ['PR is OPEN on GitHub', 'base is main', 'title is descriptive'],
    },
    run_pr_reviewer: {
      step: 1,
      prompt: prNum
        ? `Run PR Reviewer for PR #${prNum} on ${repo}. Review the JSON output for production-impacting red flags.`
        : `Run PR Reviewer for the open PR on ${repo}. Review the JSON output for production-impacting red flags.`,
      approval_required: false,
      acceptance_criteria: ['reviewer exits 0', 'verdict.status is WARN or PASS', 'no production_impact: true flags'],
    },
    merge_pr: {
      step: 1,
      prompt: prNum
        ? `Merge PR #${prNum} on ${repo} using squash merge and delete the branch. Requires Owner approval. Confirm all checks pass before running.`
        : `Merge the open PR on ${repo} using squash merge. Requires Owner approval.`,
      approval_required: true,
      acceptance_criteria: ['PR state is MERGED', 'branch is deleted', 'main is updated'],
    },
    sync_main_after_merge: {
      step: 1,
      prompt: 'Checkout main and pull from niko remote. Verify working tree is clean and log shows the merge commit.',
      approval_required: false,
      acceptance_criteria: ['git status is clean on main', 'git log shows merge commit'],
    },
    stop_fix_required: {
      step: 0,
      prompt: 'Manual intervention required. Inspect the stop_conditions in this report, fix the issue, then re-run the governor.',
      approval_required: true,
      acceptance_criteria: ['All stop_conditions are resolved', 'Governor re-run returns PASS or WARN without stop_fix_required'],
    },
    idle: {
      step: 0,
      prompt: 'System is idle. No action required. Re-run governor when starting new work.',
      approval_required: false,
      acceptance_criteria: ['N/A'],
    },
  };

  const entry = promptMap[nextAction];
  if (entry) return [entry];
  return [{
    step: 1,
    prompt: `Proceed with action: ${nextAction}. Review the commands[] field for exact steps.`,
    approval_required: true,
    acceptance_criteria: ['Action completes without errors'],
  }];
}

// ── Status/risk mapping ───────────────────────────────────────────────────────

function computeStatusRisk(nextAction, failureClassification, contradictions) {
  const hasBlockers = failureClassification.real_blockers.length > 0;
  const hasGates    = ['push_branch', 'create_pr', 'merge_pr', 'commit_changes'].includes(nextAction);
  const isStop      = nextAction === 'stop_fix_required' || nextAction === 'stop_human_approval_required';

  if (isStop && hasBlockers)  return { status: 'FAIL', risk_level: 3 };
  if (isStop)                 return { status: 'WARN', risk_level: 2 };
  if (hasBlockers)            return { status: 'FAIL', risk_level: 3 };
  if (hasGates || contradictions.length > 0) return { status: 'WARN', risk_level: 1 };
  if (nextAction === 'idle')  return { status: 'PASS', risk_level: 0 };
  return { status: 'WARN', risk_level: 1 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run(argv, injectedBotResults) {
  const t0   = Date.now();
  const args = parseArgs(argv);
  const ts   = new Date().toISOString();

  const botResults = injectedBotResults || gatherBotResults(args);

  const repoState        = extractRepoState(botResults);
  const branchState      = extractBranchState(botResults);
  const prState          = extractPrState(botResults, args.pr);
  const validationState  = extractValidationState(botResults);
  const contradictions   = detectContradictions(botResults, repoState);
  const failureClass     = classifyFailures(botResults, repoState, prState, contradictions);

  const { next_action, stopConditions, notes, confidence } =
    decide(repoState, branchState, prState, validationState, botResults, failureClass, contradictions);

  const commands      = buildCommands(next_action, repoState, prState, args.repo);
  const prompts       = buildPrompts(next_action, repoState, prState, args.repo);
  const approvalGates = buildApprovalGates(next_action, prState);
  const { status, risk_level } = computeStatusRisk(next_action, failureClass, contradictions);

  const nextActionDescriptions = {
    confirm_clean_main:           'Checkout main and pull from remote to ensure it is clean and up to date',
    create_branch:                'Create a new feature branch from main',
    inspect_system:               'Run coordinator and preflight to get a full system snapshot',
    implement_feature:            'Implement the planned feature on the current branch',
    run_validation:               'Run pnpm typecheck, lint, test, and build',
    commit_changes:               'Stage and commit modified files with a descriptive message',
    push_branch:                  'Push branch to remote and create tracking ref',
    create_pr:                    'Open a pull request from the current branch to main',
    run_pr_reviewer:              'Run PR Reviewer to classify risk and run validation suite',
    classify_blocker:             'Investigate production-impacting reviewer findings before proceeding',
    patch_feature:                'Fix failing tests or implementation before retrying validation',
    patch_reviewer:               'Update PR Reviewer allowlist or classifier to handle a known false positive',
    patch_governor:               'Update Workflow Governor decision logic or failure taxonomy',
    rerun_validation:             'Re-run validation suite after a fix',
    merge_pr:                     'Merge PR using squash strategy — requires Owner approval',
    sync_main_after_merge:        'Checkout main and pull to sync the merged commit locally',
    stop_human_approval_required: 'HALT — ambiguous state requires manual inspection and decision',
    stop_fix_required:            'HALT — one or more blocking conditions must be resolved before continuing',
    idle:                         'No action required — system is in a stable, clean state',
  };

  return {
    agent:   AGENT,
    label:   LABEL,
    status,
    risk_level,
    timestamp: ts,
    repo:    args.repo,
    repo_state:       repoState,
    branch_state:     branchState,
    pr_state:         prState,
    validation_state: validationState,
    bot_results:      botResults,
    contradictions,
    failure_classification: failureClass,
    approval_gates:   approvalGates,
    next_action,
    next_action_description: nextActionDescriptions[next_action] || next_action,
    confidence,
    commands,
    prompts,
    stop_conditions: stopConditions,
    notes,
    metadata: {
      execution_time_ms: Date.now() - t0,
      coordinator_report: args.coordinatorReport || null,
      log_path: 'logs/mc/latest.json',
    },
  };
}

module.exports = {
  run,
  parseArgs,
  extractRepoState,
  extractBranchState,
  extractPrState,
  extractValidationState,
  detectContradictions,
  classifyFailures,
  decide,
  buildCommands,
  buildPrompts,
  buildApprovalGates,
  computeStatusRisk,
  adjustConfidence,
  NEXT_ACTIONS,
  FAILURE_TYPES,
};

if (require.main === module) {
  try {
    const result = run(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        agent: AGENT,
        label: LABEL,
        status: 'FAIL',
        risk_level: 3,
        error: err && err.message ? err.message : String(err),
      }, null, 2) + '\n'
    );
    process.exit(1);
  }
}
