#!/usr/bin/env node
/**
 * mc-recommend.cjs — Recommendation Engine v1.
 * Reads latest.json + drift history to produce prioritised recommended actions.
 * Observe-only. Never auto-applies anything.
 *
 * Env override (for testing):
 *   MC_LOG_DIR — base log directory (default: logs/mc)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('node:fs');
const path = require('node:path');

const ROOT        = path.resolve(__dirname, '..');
const LOG_DIR     = process.env.MC_LOG_DIR || path.join(ROOT, 'logs', 'mc');
const LATEST_PATH = path.join(LOG_DIR, 'latest.json');
const DRIFT_SCRIPT = path.join(__dirname, 'mc-drift.cjs');

// ── I/O ───────────────────────────────────────────────────────────────────────

function readLatest() {
  try {
    return JSON.parse(fs.readFileSync(LATEST_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function runDrift() {
  const r = spawnSync('node', [DRIFT_SCRIPT], {
    encoding: 'utf-8',
    cwd: ROOT,
    env: { ...process.env, MC_LOG_DIR: LOG_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000,
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// ── Rule engine ───────────────────────────────────────────────────────────────

function recommend(latest, drift) {
  const recs = [];

  // ── Rule 1: dual lockfile persists ──────────────────────────────────────────
  const agentOutputs = Object.values(latest?.agents || {});
  const hasDualLockfile = agentOutputs.some(a => a?.packages?.dual_lockfile_warn === true);
  if (hasDualLockfile) {
    recs.push({
      id: 'lockfile-hygiene',
      priority: 'medium',
      trigger: 'dual lockfile warning persists across runs',
      action: 'Review lockfile hygiene — both pnpm-lock.yaml and package-lock.json are present. Confirm pnpm is the sole package manager, then remove package-lock.json manually.',
      auto_apply: false,
    });
  }

  // ── Rule 2: any agent FAIL ───────────────────────────────────────────────────
  const failingAgents = Object.entries(latest?.agents || {})
    .filter(([, a]) => (a?.status || '').toUpperCase() === 'FAIL')
    .map(([id]) => id);
  for (const id of failingAgents) {
    recs.push({
      id: `agent-fail-${id}`,
      priority: 'critical',
      trigger: `agent ${id} is in FAIL state`,
      action: `Investigate failing agent: ${id}. Check logs and last error for root cause.`,
      auto_apply: false,
    });
  }

  // ── Rule 3: risk level increased ─────────────────────────────────────────────
  const riskChange = drift?.changes?.risk_change;
  if (riskChange && riskChange.after > riskChange.before) {
    recs.push({
      id: 'risk-increase',
      priority: 'high',
      trigger: `risk_level rose from ${riskChange.before} to ${riskChange.after}`,
      action: `Risk level increased between runs. Review new warnings and agent status changes before proceeding.`,
      auto_apply: false,
    });
  }

  // ── Rule 4: agent status degraded ────────────────────────────────────────────
  const statusDegradation = (drift?.changes?.agent_status_changes || [])
    .filter(c => {
      const rank = { OK: 0, ok: 0, WARN: 1, FAIL: 2 };
      return (rank[c.after] || 0) > (rank[c.before] || 0);
    });
  for (const c of statusDegradation) {
    recs.push({
      id: `agent-degraded-${c.agent}`,
      priority: 'high',
      trigger: `agent ${c.agent} degraded from ${c.before} to ${c.after}`,
      action: `Agent ${c.agent} has worsened. Review its output in latest.json for new issues.`,
      auto_apply: false,
    });
  }

  // ── Rule 5: new warnings appeared ────────────────────────────────────────────
  for (const w of (drift?.changes?.new_warnings || [])) {
    recs.push({
      id: `new-warning-${Buffer.from(w).toString('base64').slice(0, 12)}`,
      priority: 'medium',
      trigger: `new warning detected: "${w}"`,
      action: `Address new warning: ${w}`,
      auto_apply: false,
    });
  }

  // ── Rule 6: missing agents ────────────────────────────────────────────────────
  for (const id of (drift?.changes?.missing_agents || [])) {
    recs.push({
      id: `missing-agent-${id}`,
      priority: 'high',
      trigger: `agent ${id} was present in previous run but is now missing`,
      action: `Agent ${id} disappeared from the registry or failed to start. Verify agent-registry.json and the agent script.`,
      auto_apply: false,
    });
  }

  // ── Rule 7: uncommitted changes ──────────────────────────────────────────────
  const hasUncommitted = agentOutputs.some(a => a?.git?.is_clean === false);
  if (hasUncommitted) {
    recs.push({
      id: 'uncommitted-changes',
      priority: 'low',
      trigger: 'working tree has uncommitted changes',
      action: 'Review and commit or stash uncommitted changes to keep the working tree clean.',
      auto_apply: false,
    });
  }

  // ── Rule 8: resolved warnings (positive signal) ───────────────────────────────
  if ((drift?.changes?.resolved_warnings || []).length > 0) {
    recs.push({
      id: 'warnings-resolved',
      priority: 'info',
      trigger: `${drift.changes.resolved_warnings.length} warning(s) resolved since last run`,
      action: `Resolved: ${drift.changes.resolved_warnings.join('; ')}. No action needed.`,
      auto_apply: false,
    });
  }

  return recs;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const latest = readLatest();
const drift  = runDrift();

if (!latest) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    status: 'error',
    message: `Cannot read latest.json from ${LATEST_PATH}`,
    recommendations: [],
  }, null, 2));
  process.exit(1);
}

const recommendations = recommend(latest, drift);
const priorities = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
recommendations.sort((a, b) => (priorities[b.priority] || 0) - (priorities[a.priority] || 0));

console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  label: 'OBSERVE ONLY',
  coordinator_status: latest.status || null,
  drift_detected: drift?.drift_detected ?? null,
  total: recommendations.length,
  recommendations,
}, null, 2));
