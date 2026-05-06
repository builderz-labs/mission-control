#!/usr/bin/env node
/**
 * mc-execute.cjs — Approval Enforcement v1.
 * Reads approved decisions from approvals.jsonl and dispatches them.
 * Tracks execution state in executed.jsonl — never modifies approvals.jsonl.
 *
 * Env overrides (for testing):
 *   MC_LOG_DIR — base log directory (default: logs/mc)
 *   MC_ROOT    — project root for file operations (default: repo root)
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const SCRIPT_ROOT      = path.resolve(__dirname, '..');
const MC_ROOT          = process.env.MC_ROOT    || SCRIPT_ROOT;
const LOG_DIR          = process.env.MC_LOG_DIR || path.join(SCRIPT_ROOT, 'logs', 'mc');
const APPROVALS_PATH   = path.join(LOG_DIR, 'approvals.jsonl');
const EXECUTED_PATH    = path.join(LOG_DIR, 'executed.jsonl');
const EXECUTION_FLAG   = '--apply-approved';

// ── I/O ───────────────────────────────────────────────────────────────────────

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function appendLine(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf-8');
}

function resolveApprovedLockfilePath(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const lockPath = path.resolve(resolvedRoot, 'package-lock.json');
  const relativePath = path.relative(resolvedRoot, lockPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Resolved lockfile target escaped MC_ROOT');
  }

  if (path.basename(lockPath) !== 'package-lock.json') {
    throw new Error('Deletion target must be package-lock.json');
  }

  return lockPath;
}

// ── Dispatch gate ─────────────────────────────────────────────────────────────
// Only decision_ids listed here are allowed to run their actual handler.
// Any decision_id present in DISPATCH but absent from DISPATCH_GATE is routed
// to defaultDispatch (acknowledge-only), preventing unintended mutations even
// if the handler was added to DISPATCH without a corresponding gate update.
const DISPATCH_GATE = new Set([
  'lockfile-hygiene',
]);

// ── Dispatch map ──────────────────────────────────────────────────────────────
// Each handler returns { result, action_taken, output }.
// 'success'     — action completed.
// 'skipped'     — nothing to do (already in desired state).
// 'acknowledged'— informational decision recorded.
// 'error'       — dispatch failed.

const DISPATCH = {
  'lockfile-hygiene': () => {
    const lockPath = resolveApprovedLockfilePath(MC_ROOT);
    if (!fs.existsSync(lockPath)) {
      return { result: 'skipped', action_taken: 'package-lock.json already absent', output: lockPath };
    }
    const lockStat = fs.statSync(lockPath);
    if (!lockStat.isFile()) {
      return { result: 'error', action_taken: 'Refused to delete non-file package-lock.json target', output: lockPath };
    }
    try {
      fs.unlinkSync(lockPath);
      return { result: 'success', action_taken: 'Deleted package-lock.json', output: lockPath };
    } catch (e) {
      return { result: 'error', action_taken: 'Failed to delete package-lock.json', output: e.message };
    }
  },
};

function defaultDispatch(decision) {
  return {
    result: 'acknowledged',
    action_taken: `Acknowledged: ${decision.action || decision.decision_id}`,
    output: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const approvals = readLines(APPROVALS_PATH);
const executed  = readLines(EXECUTED_PATH);
const executedIds = new Set(executed.map(e => e.decision_id));
const applyApproved = process.argv.includes(EXECUTION_FLAG);

const approved  = approvals.filter(a => a.status === 'approved');
const pending   = approved.filter(a => !executedIds.has(a.decision_id));
const rejected  = approvals.filter(a => a.status === 'rejected');

const results = [];

if (applyApproved) {
  for (const decision of pending) {
    // Gate check: route to defaultDispatch if the decision_id is not in DISPATCH_GATE,
    // even if a handler exists in DISPATCH. This prevents unregistered mutations.
    const isGated = DISPATCH_GATE.has(decision.decision_id);
    const handler = isGated
      ? (DISPATCH[decision.decision_id] || (() => defaultDispatch(decision)))
      : (() => defaultDispatch(decision));
    let dispatch;
    try {
      dispatch = handler(decision);
    } catch (e) {
      dispatch = { result: 'error', action_taken: 'Dispatch threw', output: e.message };
    }

    const entry = {
      decision_id:  decision.decision_id,
      executed_at:  new Date().toISOString(),
      result:       dispatch.result,
      action_taken: dispatch.action_taken,
      output:       dispatch.output,
    };

    appendLine(EXECUTED_PATH, entry);
    results.push(entry);
  }
}

console.log(JSON.stringify({
  status: 'ok',
  mode: applyApproved ? 'apply-approved' : 'observe-only',
  execution_enabled: applyApproved,
  timestamp: new Date().toISOString(),
  total_approved:  approved.length,
  total_rejected:  rejected.length,
  already_executed: executedIds.size,
  pending_execution: pending.length,
  dispatched: results.length,
  results,
}, null, 2));
