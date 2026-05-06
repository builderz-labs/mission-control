#!/usr/bin/env node
/**
 * Repo Steward v1 — observe-only repository health agent.
 * Emits a single JSON object to stdout. Never modifies files.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

function safeExec(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    // Non-zero exit (e.g. git rev-list when no upstream) — return stdout if any
    return e.stdout ? e.stdout.trim() : null;
  }
}

function checkGit() {
  const branch = safeExec('git rev-parse --abbrev-ref HEAD');
  const statusRaw = safeExec('git status --short');
  const isClean = !statusRaw || statusRaw.length === 0;
  const commitsRaw = safeExec('git log --oneline -5');
  const remotesRaw = safeExec('git remote -v');

  let ahead = null;
  let behind = null;
  const trackRaw = safeExec('git rev-list --left-right --count HEAD...@{upstream}');
  if (trackRaw && /^\d+\s+\d+$/.test(trackRaw)) {
    const parts = trackRaw.split(/\s+/).map(Number);
    ahead = parts[0];
    behind = parts[1];
  }

  return {
    branch: branch || null,
    is_clean: isClean,
    status_short: statusRaw ? statusRaw.split('\n').filter(Boolean).slice(0, 15) : [],
    commits_recent: commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [],
    remotes: remotesRaw ? remotesRaw.split('\n').filter(Boolean) : [],
    ahead_of_upstream: ahead,
    behind_upstream: behind,
  };
}

function checkPackages() {
  const hasPkgJson = fs.existsSync(path.join(ROOT, 'package.json'));
  const hasPnpmLock = fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'));
  const hasNpmLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));

  let scripts = {};
  let depCount = 0;
  let devDepCount = 0;

  if (hasPkgJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
      scripts = pkg.scripts || {};
      depCount = Object.keys(pkg.dependencies || {}).length;
      devDepCount = Object.keys(pkg.devDependencies || {}).length;
    } catch {}
  }

  return {
    package_json: hasPkgJson,
    pnpm_lock: hasPnpmLock,
    npm_lock: hasNpmLock,
    dual_lockfile_warn: hasPnpmLock && hasNpmLock,
    scripts_available: Object.keys(scripts),
    dependency_count: depCount,
    dev_dependency_count: devDepCount,
    freshness_note: 'Run pnpm outdated to check for stale dependencies (observe-only, not run here)',
  };
}

function checkProjectStructure() {
  const dirs = [
    'docs/mission-control',
    'scripts',
    'src/lib',
    'src/app/api',
  ];
  const result = {};
  for (const dir of dirs) {
    result[dir] = fs.existsSync(path.join(ROOT, dir));
  }
  return result;
}

function buildReport(git, packages, structure) {
  const warnings = [];
  let risk = 0;

  if (!git.is_clean) {
    warnings.push('Working tree has uncommitted changes');
    risk = Math.max(risk, 1);
  }
  if (git.behind_upstream !== null && git.behind_upstream > 0) {
    warnings.push(`Branch is ${git.behind_upstream} commit(s) behind upstream`);
    risk = Math.max(risk, 2);
  }
  if (packages.dual_lockfile_warn) {
    warnings.push('Both pnpm-lock.yaml and package-lock.json present — remove package-lock.json to avoid conflicts');
    risk = Math.max(risk, 1);
  }
  if (!packages.package_json) {
    warnings.push('package.json not found');
    risk = Math.max(risk, 3);
  }
  if (!packages.pnpm_lock) {
    warnings.push('pnpm-lock.yaml missing');
    risk = Math.max(risk, 1);
  }

  const missingDirs = Object.entries(structure)
    .filter(([, exists]) => !exists)
    .map(([d]) => d);
  if (missingDirs.length > 0) {
    warnings.push(`Missing expected directories: ${missingDirs.join(', ')}`);
    risk = Math.max(risk, 1);
  }

  const recommended = [];
  if (!git.is_clean) recommended.push('Review and commit or stash uncommitted changes');
  if (git.behind_upstream !== null && git.behind_upstream > 0) recommended.push('Pull latest from upstream to stay current');
  if (packages.dual_lockfile_warn) recommended.push('Delete package-lock.json — project uses pnpm');
  if (missingDirs.length > 0) recommended.push(`Create missing directories: ${missingDirs.join(', ')}`);
  recommended.push('Run: pnpm outdated   (check dependency freshness — observe only)');
  recommended.push('Run: pnpm test       (verify suite health)');
  recommended.push('Run: pnpm typecheck  (verify type correctness)');
  if (warnings.length === 0) recommended.unshift('Repository is clean — no immediate actions required');

  const status = risk === 0 ? 'PASS' : risk <= 1 ? 'WARN' : risk <= 2 ? 'WARN' : 'FAIL';

  return { warnings, risk, status, recommended };
}

const git = checkGit();
const packages = checkPackages();
const structure = checkProjectStructure();
const { warnings, risk, status, recommended } = buildReport(git, packages, structure);

const report = {
  agent: 'Repo Steward v1',
  label: 'OBSERVE ONLY',
  status,
  risk_level: risk,
  git,
  packages,
  project_structure: structure,
  warnings,
  recommended_next_actions: recommended,
};

console.log(JSON.stringify(report, null, 2));
