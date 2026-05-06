#!/usr/bin/env node
/**
 * pr-lifecycle-orchestrator.cjs
 * Observe-only PR Lifecycle Orchestrator v1.
 * Inspects local git state and optional PR metadata, then recommends exactly
 * one next safe repo action.
 *
 * Never writes files, mutates git state, pushes, merges, or creates PRs.
 * Exits 0 for PASS/WARN. Exits 1 only on script/runtime failure.
 *
 * Usage:
 *   node scripts/pr-lifecycle-orchestrator.cjs
 *   node scripts/pr-lifecycle-orchestrator.cjs --repo niko4244/mission-control --pr 6
 *   node scripts/pr-lifecycle-orchestrator.cjs --branch my-feature
 */

'use strict';

const { spawnSync } = require('node:child_process');

const AGENT = 'PR Lifecycle Orchestrator v1';
const LABEL = 'OBSERVE ONLY';
const DEFAULT_REPO = 'niko4244/mission-control';
const MAIN_BRANCHES = new Set(['main', 'master']);

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, pr: null, branch: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i] ?? DEFAULT_REPO;
    else if (a === '--pr') args.pr = Number(argv[++i]) || null;
    else if (a === '--branch') args.branch = argv[++i] ?? null;
  }
  return args;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(args, opts) {
  const r = spawnSync('git', args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 10000,
    ...opts,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function gh(args) {
  const r = spawnSync('gh', args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 15000,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

// ── Branch inspection ─────────────────────────────────────────────────────────

function inspectBranch(overrideBranch) {
  const currentRes = git(['branch', '--show-current']);
  const current = overrideBranch || (currentRes.ok ? currentRes.stdout : null);

  if (!current) {
    return {
      current: null,
      is_main: false,
      tracking: null,
      ahead: null,
      behind: null,
      working_tree_clean: false,
      error: 'Could not determine current branch',
    };
  }

  const isMain = MAIN_BRANCHES.has(current);

  // Working tree status
  const statusRes = git(['status', '--short']);
  const workingTreeClean = statusRes.ok && statusRes.stdout === '';

  // Tracking branch
  const trackingRes = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const tracking = trackingRes.ok ? trackingRes.stdout : null;

  // Ahead/behind counts
  let ahead = null;
  let behind = null;
  if (tracking) {
    const abRes = git(['rev-list', '--left-right', '--count', `${tracking}...HEAD`]);
    if (abRes.ok) {
      const parts = abRes.stdout.split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  }

  return { current, is_main: isMain, tracking, ahead, behind, working_tree_clean: workingTreeClean };
}

// ── PR inspection ─────────────────────────────────────────────────────────────

function inspectPr(repo, prNumber) {
  const empty = { number: null, state: null, base: null, head: null, mergeable: null, changed_files: null };
  if (!prNumber) return empty;

  const res = gh([
    'pr', 'view', String(prNumber),
    '--repo', repo,
    '--json', 'number,state,baseRefName,headRefName,mergeable,changedFiles',
  ]);

  if (!res.ok) {
    return { ...empty, number: prNumber, error: res.stderr || 'gh pr view failed' };
  }

  let data;
  try { data = JSON.parse(res.stdout); } catch { return { ...empty, number: prNumber, error: 'JSON parse failed' }; }

  return {
    number: data.number ?? prNumber,
    state: data.state ?? null,
    base: data.baseRefName ?? null,
    head: data.headRefName ?? null,
    mergeable: data.mergeable ?? null,
    changed_files: data.changedFiles ?? null,
  };
}

// ── Decision engine ───────────────────────────────────────────────────────────

/**
 * next_action enum:
 *   confirm_clean_main | create_branch | validate_branch | commit_changes |
 *   push_branch | create_pr | run_pr_reviewer | merge_pr |
 *   sync_main_after_merge | stop_fix_required | idle
 */
function decide(branch, pr, repo) {
  const stopConditions = [];
  const notes = [];

  // Any git inspection failure
  if (!branch.current) {
    stopConditions.push('Could not determine current branch — git may be in a detached HEAD state');
    return { next_action: 'stop_fix_required', stopConditions, notes };
  }

  // Dirty main
  if (branch.is_main && !branch.working_tree_clean) {
    stopConditions.push('Working tree is dirty on main — stash or commit before continuing');
    return { next_action: 'stop_fix_required', stopConditions, notes };
  }

  // Dirty feature branch
  if (!branch.is_main && !branch.working_tree_clean) {
    notes.push('Working tree has uncommitted changes — commit or stash before pushing');
    return { next_action: 'commit_changes', stopConditions, notes };
  }

  // Clean main — nothing in flight
  if (branch.is_main && branch.working_tree_clean) {
    if (!pr.number) {
      notes.push('main is clean with no PR in scope');
      return { next_action: 'idle', stopConditions, notes };
    }
    // PR provided: might be post-merge sync check
    if (pr.state === 'MERGED') {
      notes.push('PR is already merged — main may need a pull to sync');
      return { next_action: 'sync_main_after_merge', stopConditions, notes };
    }
    if (pr.state === 'OPEN') {
      notes.push('On main with an open PR — switch to the feature branch to continue');
      return { next_action: 'run_pr_reviewer', stopConditions, notes };
    }
    return { next_action: 'idle', stopConditions, notes };
  }

  // Clean feature branch from here on
  if (!branch.tracking) {
    notes.push('Branch has no upstream tracking ref — push to create it');
    return { next_action: 'push_branch', stopConditions, notes };
  }

  // Pushed but nothing ahead (might just be synced)
  if (branch.ahead === 0 && branch.behind === 0 && !pr.number) {
    notes.push('Branch is in sync with tracking but no PR exists yet');
    return { next_action: 'create_pr', stopConditions, notes };
  }

  // Ahead of tracking — needs push
  if (branch.ahead !== null && branch.ahead > 0) {
    notes.push(`Branch is ${branch.ahead} commit(s) ahead of ${branch.tracking} — push before opening PR`);
    return { next_action: 'push_branch', stopConditions, notes };
  }

  // Clean pushed branch, PR provided
  if (pr.number) {
    if (pr.state === 'OPEN') {
      if (pr.mergeable === 'MERGEABLE') {
        notes.push(`PR #${pr.number} is open and mergeable — run reviewer first`);
        return { next_action: 'run_pr_reviewer', stopConditions, notes };
      }
      if (pr.mergeable === 'CONFLICTING') {
        stopConditions.push(`PR #${pr.number} has merge conflicts — resolve before merging`);
        return { next_action: 'stop_fix_required', stopConditions, notes };
      }
      notes.push(`PR #${pr.number} is open`);
      return { next_action: 'run_pr_reviewer', stopConditions, notes };
    }
    if (pr.state === 'MERGED') {
      notes.push(`PR #${pr.number} is already merged — sync main`);
      return { next_action: 'sync_main_after_merge', stopConditions, notes };
    }
    if (pr.state === 'CLOSED') {
      stopConditions.push(`PR #${pr.number} is closed without merging — investigate before proceeding`);
      return { next_action: 'stop_fix_required', stopConditions, notes };
    }
  }

  // Clean pushed branch, no PR
  notes.push('Branch is pushed and clean — ready to open a PR');
  return { next_action: 'create_pr', stopConditions, notes };
}

// ── Command generator ─────────────────────────────────────────────────────────

function buildCommands(nextAction, branch, pr, repo) {
  const b = branch.current || '<branch>';
  const prNum = pr.number;

  switch (nextAction) {
    case 'confirm_clean_main':
      return ['git checkout main', 'git pull niko main', 'git status --short'];

    case 'create_branch':
      return ['git checkout -b <new-branch-name>'];

    case 'validate_branch':
      return ['pnpm typecheck', 'pnpm lint', 'pnpm test --run', 'pnpm build'];

    case 'commit_changes':
      return [
        'git status --short',
        'git diff',
        `git add <files>`,
        `git commit -m "feat: <describe change>"`,
      ];

    case 'push_branch':
      return [`git push -u niko ${b}`];

    case 'create_pr':
      return [
        `gh pr create --repo ${repo} --base main --head ${b} --title "<title>" --body "<body>"`,
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
      return ['git checkout main', 'git pull niko main', 'git status --short', 'git log --oneline -5'];

    case 'stop_fix_required':
      return ['git status --short', 'git diff'];

    case 'idle':
    default:
      return ['node scripts/mc-coordinator.cjs'];
  }
}

// ── Risk/status mapping ───────────────────────────────────────────────────────

function classify(nextAction, stopConditions) {
  if (nextAction === 'stop_fix_required' || stopConditions.length > 0) {
    return { status: 'WARN', risk_level: 2 };
  }
  if (['push_branch', 'create_pr', 'run_pr_reviewer', 'merge_pr', 'sync_main_after_merge'].includes(nextAction)) {
    return { status: 'WARN', risk_level: 1 };
  }
  if (['commit_changes', 'validate_branch', 'create_branch'].includes(nextAction)) {
    return { status: 'WARN', risk_level: 1 };
  }
  return { status: 'PASS', risk_level: 0 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run(argv) {
  const args = parseArgs(argv);
  const branch = inspectBranch(args.branch);
  const pr = inspectPr(args.repo, args.pr);
  const { next_action, stopConditions, notes } = decide(branch, pr, args.repo);
  const commands = buildCommands(next_action, branch, pr, args.repo);
  const { status, risk_level } = classify(next_action, stopConditions);

  return {
    agent: AGENT,
    label: LABEL,
    status,
    risk_level,
    repo: args.repo,
    branch: {
      current: branch.current,
      is_main: branch.is_main,
      tracking: branch.tracking,
      ahead: branch.ahead,
      behind: branch.behind,
      working_tree_clean: branch.working_tree_clean,
    },
    pr: {
      number: pr.number,
      state: pr.state,
      base: pr.base,
      head: pr.head,
      mergeable: pr.mergeable,
      changed_files: pr.changed_files,
    },
    next_action,
    commands,
    stop_conditions: stopConditions,
    notes,
  };
}

module.exports = { run, inspectBranch, inspectPr, decide, buildCommands };

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
