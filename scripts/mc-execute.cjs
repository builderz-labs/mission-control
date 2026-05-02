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

// ── Dispatch map ──────────────────────────────────────────────────────────────
// Each handler returns { result, action_taken, output }.
// 'success'     — action completed.
// 'skipped'     — nothing to do (already in desired state).
// 'acknowledged'— informational decision recorded.
// 'error'       — dispatch failed.

const DISPATCH = {
  'lockfile-hygiene': () => {
    const lockPath = path.join(MC_ROOT, 'package-lock.json');
    if (!fs.existsSync(lockPath)) {
      return { result: 'skipped', action_taken: 'package-lock.json already absent', output: lockPath };
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

const approved  = approvals.filter(a => a.status === 'approved');
const pending   = approved.filter(a => !executedIds.has(a.decision_id));
const rejected  = approvals.filter(a => a.status === 'rejected');

const results = [];

for (const decision of pending) {
  const handler = DISPATCH[decision.decision_id] || (() => defaultDispatch(decision));
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

console.log(JSON.stringify({
  status: 'ok',
  timestamp: new Date().toISOString(),
  total_approved:  approved.length,
  total_rejected:  rejected.length,
  already_executed: executedIds.size,
  dispatched: results.length,
  results,
}, null, 2));
