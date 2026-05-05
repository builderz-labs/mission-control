#!/usr/bin/env node
/**
 * mc-drift.cjs — Drift Detection v1.
 * Compares the last two coordinator runs in history.jsonl and reports changes.
 * Read-only. No git, no network, no mutation.
 *
 * Env override (for testing):
 *   MC_LOG_DIR — base log directory (default: logs/mc)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = process.env.MC_LOG_DIR || path.join(ROOT, 'logs', 'mc');
const HISTORY_PATH = path.join(LOG_DIR, 'history.jsonl');

// ── Read ──────────────────────────────────────────────────────────────────────

function readHistory() {
  try {
    const lines = fs.readFileSync(HISTORY_PATH, 'utf-8')
      .trim().split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}

// ── Detect ────────────────────────────────────────────────────────────────────

function detectDrift(current, previous) {
  const changes = {
    new_warnings:        [],
    resolved_warnings:   [],
    risk_change:         null,
    agent_status_changes:[],
    new_agents:          [],
    missing_agents:      [],
    notes:               [],
  };

  const curWarnings  = current.summary?.warnings  || [];
  const prevWarnings = previous.summary?.warnings || [];

  changes.new_warnings      = curWarnings .filter(w => !prevWarnings.includes(w));
  changes.resolved_warnings = prevWarnings.filter(w => !curWarnings .includes(w));

  if (current.risk_level !== previous.risk_level) {
    changes.risk_change = { before: previous.risk_level, after: current.risk_level };
  }

  const curAgents  = Object.keys(current.agents  || {});
  const prevAgents = Object.keys(previous.agents || {});

  changes.new_agents     = curAgents .filter(a => !prevAgents.includes(a));
  changes.missing_agents = prevAgents.filter(a => !curAgents .includes(a));

  for (const id of curAgents.filter(a => prevAgents.includes(a))) {
    const before = ((previous.agents[id]?.status) || 'UNKNOWN').toUpperCase();
    const after  = ((current .agents[id]?.status) || 'UNKNOWN').toUpperCase();
    if (before !== after) {
      changes.agent_status_changes.push({ agent: id, before, after });
    }
  }

  if (changes.new_agents    .length > 0) changes.notes.push(`New agents: ${changes.new_agents.join(', ')}`);
  if (changes.missing_agents.length > 0) changes.notes.push(`Missing agents: ${changes.missing_agents.join(', ')}`);

  const driftDetected =
    changes.new_warnings        .length > 0 ||
    changes.resolved_warnings   .length > 0 ||
    changes.risk_change         !== null     ||
    changes.agent_status_changes.length > 0 ||
    changes.new_agents          .length > 0 ||
    changes.missing_agents      .length > 0;

  return { driftDetected, changes };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const history = readHistory();

if (history.length === 0) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    drift_detected: false,
    changes: { notes: ['No history found — cannot compare runs'] },
  }, null, 2));
  process.exit(0);
}

if (history.length === 1) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    drift_detected: false,
    changes: { notes: ['Only one run in history — nothing to compare yet'] },
  }, null, 2));
  process.exit(0);
}

const current  = history[history.length - 1];
const previous = history[history.length - 2];

const { driftDetected, changes } = detectDrift(current, previous);

console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  drift_detected: driftDetected,
  current_run:  current .timestamp || null,
  previous_run: previous.timestamp || null,
  changes,
}, null, 2));
