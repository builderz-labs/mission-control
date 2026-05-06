#!/usr/bin/env node
/**
 * mission-control-preflight.cjs
 * Deterministic, local-only environment checks before Mission Control runs.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'OBSERVE ONLY';

function commandCandidates(command) {
  if (process.platform !== 'win32') return [command];
  if (/\.(cmd|bat|exe)$/i.test(command)) return [command];
  return [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`];
}

function useShellForCandidate(candidate) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate);
}

function firstNonEmptyLine(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const line = text.split(/\r?\n/).find(Boolean);
  return line || null;
}

function defaultRunCommand(command, args, cwd) {
  for (const candidate of commandCandidates(command)) {
    const result = spawnSync(candidate, args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShellForCandidate(candidate),
      windowsHide: true,
      timeout: 5000,
    });

    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }

    if (result.error) {
      return {
        ok: false,
        stdout: '',
        stderr: '',
        error: result.error.message,
      };
    }

    return {
      ok: result.status === 0,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
      error: result.status === 0
        ? null
        : firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout) || `exit ${result.status}`,
    };
  }

  return {
    ok: false,
    stdout: '',
    stderr: '',
    error: 'not found',
  };
}

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function pushUnique(values, nextValue) {
  if (nextValue && !values.includes(nextValue)) {
    values.push(nextValue);
  }
}

function runMissionControlPreflight(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const env = options.env || process.env;
  const runCommand = options.runCommand || defaultRunCommand;
  const executeRequested = options.executeRequested === true;
  const allowDangerousExecution = options.allowDangerousExecution === true;
  const allowDualLockfiles = options.allowDualLockfiles === true;
  const timestamp = new Date().toISOString();

  const checks = [];
  const failures = [];
  const warnings = [];
  const next_actions = [];

  const addCheck = (name, status, message, details = {}) => {
    checks.push({ name, status, message, ...details });
  };

  const toolVersions = {};

  for (const tool of ['node', 'pnpm', 'git']) {
    const result = runCommand(tool, ['--version'], root);
    if (!result.ok) {
      const message = `${tool} is not available (${result.error || 'not found'}).`;
      failures.push(message);
      pushUnique(next_actions, `Install or expose ${tool} before running Mission Control.`);
      addCheck(`tool:${tool}`, 'FAIL', message);
      toolVersions[tool] = null;
      continue;
    }

    toolVersions[tool] = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
    addCheck(`tool:${tool}`, 'PASS', `${tool} available`, { version: toolVersions[tool] });
  }

  let gitBranch = null;
  let gitStatusShort = [];
  let workingTreeClean = null;

  const branchResult = runCommand('git', ['branch', '--show-current'], root);
  if (!branchResult.ok || !String(branchResult.stdout || '').trim()) {
    const message = 'Unable to read current git branch';
    failures.push(message);
    pushUnique(next_actions, 'Confirm this directory is a readable git working tree before running Mission Control.');
    addCheck('git:branch', 'FAIL', message);
  } else {
    gitBranch = branchResult.stdout.trim();
    addCheck('git:branch', 'PASS', `Current branch: ${gitBranch}`);
  }

  const statusResult = runCommand('git', ['status', '--short'], root);
  if (!statusResult.ok) {
    const message = 'Unable to read git status';
    failures.push(message);
    pushUnique(next_actions, 'Restore readable git status before running Mission Control.');
    addCheck('git:status', 'FAIL', message);
  } else {
    gitStatusShort = String(statusResult.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    workingTreeClean = gitStatusShort.length === 0;
    if (workingTreeClean) {
      addCheck('git:status', 'PASS', 'Working tree is clean');
    } else {
      const message = 'Working tree is dirty';
      warnings.push(message);
      pushUnique(next_actions, 'Review or stash local changes before treating a Mission Control run as safe.');
      addCheck('git:status', 'WARN', message, { entries: gitStatusShort.slice(0, 15) });
    }
  }

  const packageJsonPath = path.join(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    const message = 'package.json is missing';
    failures.push(message);
    pushUnique(next_actions, 'Restore package.json before running Mission Control.');
    addCheck('repo:package-json', 'FAIL', message);
  } else {
    addCheck('repo:package-json', 'PASS', 'package.json present');
  }

  const hasPnpmLock = fs.existsSync(path.join(root, 'pnpm-lock.yaml'));
  const hasPackageLock = fs.existsSync(path.join(root, 'package-lock.json'));
  if (hasPnpmLock && hasPackageLock && !allowDualLockfiles) {
    const message = 'Both package-lock.json and pnpm-lock.yaml are present';
    warnings.push(message);
    pushUnique(next_actions, 'Review lockfile hygiene before running Mission Control in execution-sensitive flows.');
    addCheck('repo:lockfiles', 'WARN', message);
  } else {
    addCheck('repo:lockfiles', 'PASS', 'Lockfile state acceptable');
  }

  if (isEnabledFlag(env.MC_ALLOW_EXECUTE)) {
    const message = 'MC_ALLOW_EXECUTE is enabled';
    if (allowDangerousExecution) {
      warnings.push(message);
      pushUnique(next_actions, 'Review why MC_ALLOW_EXECUTE is enabled before continuing.');
      addCheck('env:MC_ALLOW_EXECUTE', 'WARN', message);
    } else {
      failures.push(message);
      pushUnique(next_actions, 'Disable MC_ALLOW_EXECUTE before treating this Mission Control run as safe.');
      addCheck('env:MC_ALLOW_EXECUTE', 'FAIL', message);
    }
  } else {
    addCheck('env:MC_ALLOW_EXECUTE', 'PASS', 'MC_ALLOW_EXECUTE not enabled');
  }

  if (isEnabledFlag(env.MC_DISABLE_RATE_LIMIT)) {
    const message = 'MC_DISABLE_RATE_LIMIT is enabled';
    failures.push(message);
    pushUnique(next_actions, 'Disable MC_DISABLE_RATE_LIMIT before running Mission Control in safety-sensitive mode.');
    addCheck('env:MC_DISABLE_RATE_LIMIT', 'FAIL', message);
  } else {
    addCheck('env:MC_DISABLE_RATE_LIMIT', 'PASS', 'MC_DISABLE_RATE_LIMIT not enabled');
  }

  if (executeRequested) {
    const message = 'Execution was explicitly requested for this coordinator run';
    warnings.push(message);
    pushUnique(next_actions, 'Confirm the environment is ready before honoring execute-requested flows.');
    addCheck('mode:execute-requested', 'WARN', message);
  } else {
    addCheck('mode:execute-requested', 'PASS', 'No execute request active');
  }

  const status = failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';
  const risk_level = failures.length > 0 ? 3 : warnings.length > 0 ? 1 : 0;

  const summary = {
    total_checks: checks.length,
    passed_checks: checks.filter((check) => check.status === 'PASS').length,
    warned_checks: checks.filter((check) => check.status === 'WARN').length,
    failed_checks: checks.filter((check) => check.status === 'FAIL').length,
    current_branch: gitBranch,
    working_tree_clean: workingTreeClean,
    execute_requested: executeRequested,
  };

  return {
    agent: 'Mission Control Preflight',
    label: LABEL,
    timestamp,
    status,
    risk_level,
    summary,
    checks,
    failures,
    warnings,
    next_actions,
    recommended_next_actions: [...next_actions],
    validation: { steps: [] },
    metadata: {
      root,
      checked_at: timestamp,
      execute_requested: executeRequested,
      allow_dangerous_execution: allowDangerousExecution,
    },
    git: {
      branch: gitBranch,
      is_clean: workingTreeClean,
      status_short: gitStatusShort,
    },
    capabilities: {
      node: toolVersions.node,
      pnpm: toolVersions.pnpm,
      git: toolVersions.git,
    },
  };
}

module.exports = {
  runMissionControlPreflight,
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(runMissionControlPreflight(), null, 2) + '\n');
}
