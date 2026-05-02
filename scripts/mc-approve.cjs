#!/usr/bin/env node
/**
 * mc-approve.cjs — Approval Gate v1.
 * Manages approval/rejection of mc-recommend decisions.
 * Observe-only. No execution of approved actions.
 *
 * Usage:
 *   node scripts/mc-approve.cjs list
 *   node scripts/mc-approve.cjs approve <id> [--note "text"]
 *   node scripts/mc-approve.cjs reject  <id> [--note "text"]
 *
 * Env override (for testing):
 *   MC_LOG_DIR — base log directory (default: logs/mc)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('node:fs');
const path = require('node:path');

const ROOT             = path.resolve(__dirname, '..');
const LOG_DIR          = process.env.MC_LOG_DIR || path.join(ROOT, 'logs', 'mc');
const APPROVALS_PATH   = path.join(LOG_DIR, 'approvals.jsonl');
const RECOMMEND_SCRIPT = path.join(__dirname, 'mc-recommend.cjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function readApprovals() {
  try {
    return fs.readFileSync(APPROVALS_PATH, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function getRecommendations() {
  const r = spawnSync('node', [RECOMMEND_SCRIPT], {
    encoding: 'utf-8',
    cwd: ROOT,
    env: { ...process.env, MC_LOG_DIR: LOG_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000,
  });
  try {
    return JSON.parse(r.stdout).recommendations || [];
  } catch {
    return [];
  }
}

function appendApproval(entry) {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.appendFileSync(APPROVALS_PATH, JSON.stringify(entry) + '\n', 'utf-8');
}

function parseArgs(argv) {
  const opts = { note: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--note') { opts.note = argv[++i]; continue; }
    positional.push(argv[i]);
  }
  return { positional, opts };
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdList() {
  const recs      = getRecommendations();
  const approvals = readApprovals();
  const byId      = new Map(approvals.map(a => [a.decision_id, a]));

  const decisions = recs.map(rec => ({
    id:              rec.id,
    priority:        rec.priority,
    trigger:         rec.trigger,
    action:          rec.action,
    auto_apply:      rec.auto_apply,
    approval_status: byId.get(rec.id)?.status  || 'pending',
    approved_at:     byId.get(rec.id)?.timestamp || null,
    note:            byId.get(rec.id)?.note      || null,
  }));

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const d of decisions) counts[d.approval_status] = (counts[d.approval_status] || 0) + 1;

  console.log(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    label: 'OBSERVE ONLY',
    total: decisions.length,
    ...counts,
    decisions,
  }, null, 2));
}

function cmdSetStatus(id, status, note) {
  const recs = getRecommendations();
  const rec  = recs.find(r => r.id === id);

  if (!rec) {
    console.log(JSON.stringify({
      status: 'error',
      message: `Decision "${id}" not found in current recommendations.`,
    }));
    process.exit(1);
  }

  const existing = readApprovals().find(a => a.decision_id === id);
  if (existing) {
    console.log(JSON.stringify({
      status: 'error',
      message: `Decision "${id}" already ${existing.status} at ${existing.timestamp}. Cannot change.`,
    }));
    process.exit(1);
  }

  const entry = {
    decision_id: id,
    status,
    timestamp: new Date().toISOString(),
    ...(note ? { note } : {}),
  };

  appendApproval(entry);

  console.log(JSON.stringify({
    status: 'ok',
    decision_id: entry.decision_id,
    approval: entry.status,
    timestamp: entry.timestamp,
    ...(entry.note ? { note: entry.note } : {}),
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { positional, opts } = parseArgs(process.argv.slice(2));
const command = positional[0];
const id      = positional[1];

if (!command) {
  console.log(JSON.stringify({
    status: 'error',
    message: 'Usage: mc-approve.cjs list | approve <id> | reject <id> [--note "text"]',
  }));
  process.exit(1);
}

if (command === 'list') {
  cmdList();
} else if (command === 'approve' || command === 'reject') {
  if (!id) {
    console.log(JSON.stringify({ status: 'error', message: `Usage: mc-approve.cjs ${command} <id>` }));
    process.exit(1);
  }
  cmdSetStatus(id, command === 'approve' ? 'approved' : 'rejected', opts.note);
} else {
  console.log(JSON.stringify({ status: 'error', message: `Unknown command: "${command}". Use list | approve | reject` }));
  process.exit(1);
}
