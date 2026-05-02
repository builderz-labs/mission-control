#!/usr/bin/env node
/**
 * mc-coordinator.cjs — Mission Control Coordinator v1.
 * Observe-only orchestration spine. Reads agent-registry.json,
 * runs only enabled+observe_only agents, persists logs, computes status+risk.
 *
 * Env overrides (for testing):
 *   MC_REGISTRY_PATH  — path to agent-registry.json
 *   MC_LOG_DIR        — base log directory (default: logs/mc)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = process.env.MC_REGISTRY_PATH
  || path.join(ROOT, 'data', 'mission-control', 'agent-registry.json');
const LOG_DIR = process.env.MC_LOG_DIR
  || path.join(ROOT, 'logs', 'mc');

// ── Registry ──────────────────────────────────────────────────────────────────

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch (e) {
    return { error: `Cannot load registry: ${e.message}`, agents: [] };
  }
}

function selectAgents(registry) {
  const all = registry.agents || [];
  const rejected = all.filter(a => a.enabled && !a.observe_only);
  const selected = all.filter(a => a.enabled && a.observe_only);
  return { selected, rejected };
}

// ── Agent execution ───────────────────────────────────────────────────────────

function runAgent(agent) {
  const [cmd, ...args] = agent.command;

  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: agent.timeout_ms || 30000,
  });

  if (result.error) {
    return { status: 'FAIL', error: result.error.message, risk_level: 3 };
  }

  if (result.status !== 0) {
    return {
      status: 'FAIL',
      error: (result.stderr || `exit code ${result.status}`).trim().slice(0, 300),
      risk_level: 3,
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    return {
      status: 'FAIL',
      error: `JSON parse error: ${e.message}`,
      raw_stdout: result.stdout.slice(0, 200),
      risk_level: 3,
    };
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function inferRisk(status) {
  if (status === 'OK')   return 0;
  if (status === 'WARN') return 1;
  if (status === 'FAIL') return 3;
  return 1;
}

function computeStatus(results) {
  if (!results.length) return 'WARN';
  const statuses = results.map(r => (r.status || 'UNKNOWN').toUpperCase());
  if (statuses.some(s => s === 'FAIL')) return 'FAIL';
  if (statuses.some(s => s === 'WARN')) return 'WARN';
  if (statuses.every(s => s === 'OK'))  return 'OK';
  return 'WARN';
}

function computeRisk(results) {
  if (!results.length) return 0;
  return Math.max(...results.map(r =>
    r.risk_level != null ? r.risk_level : inferRisk(r.status || 'UNKNOWN')
  ));
}

function buildSummary(agentMap, coordinatorWarnings) {
  const results = Object.values(agentMap);
  const statuses = results.map(r => (r.status || 'UNKNOWN').toUpperCase());
  const allWarnings = [
    ...coordinatorWarnings,
    ...results.flatMap(r => r.warnings || []),
  ];
  const allActions = results.flatMap(r => r.recommended_next_actions || []);

  return {
    total_agents: results.length,
    ok:   statuses.filter(s => s === 'OK').length,
    warn: statuses.filter(s => s === 'WARN').length,
    fail: statuses.filter(s => s === 'FAIL').length,
    warnings: allWarnings,
    recommended_next_actions: allActions,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────

function persistLogs(report) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(LOG_DIR, 'latest.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8'
  );
  fs.appendFileSync(
    path.join(LOG_DIR, 'history.jsonl'),
    JSON.stringify(report) + '\n',
    'utf-8'
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const registry = loadRegistry();
const { selected, rejected } = selectAgents(registry);
const coordinatorWarnings = [];

if (registry.error)      coordinatorWarnings.push(registry.error);
if (rejected.length > 0) coordinatorWarnings.push(
  `Skipped non-observe_only agents: ${rejected.map(a => a.id).join(', ')}`
);
if (selected.length === 0) coordinatorWarnings.push(
  'No enabled observe_only agents found in registry'
);

const agentResults = {};
for (const agent of selected) {
  agentResults[agent.id] = runAgent(agent);
}

const resultValues = Object.values(agentResults);
const timestamp = new Date().toISOString();

const report = {
  coordinator: 'Mission Control Coordinator v1',
  label: 'OBSERVE ONLY',
  timestamp,
  status: computeStatus(resultValues),
  risk_level: computeRisk(resultValues),
  agents: agentResults,
  summary: buildSummary(agentResults, coordinatorWarnings),
};

persistLogs(report);
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--execute')) {
  const executeResult = spawnSync('node', [path.join(__dirname, 'mc-execute.cjs')], {
    encoding: 'utf-8',
    cwd: ROOT,
    env: { ...process.env, MC_LOG_DIR: LOG_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
  });
  try {
    const execOut = JSON.parse(executeResult.stdout);
    process.stderr.write(JSON.stringify({ execute: execOut }) + '\n');
  } catch {
    process.stderr.write(JSON.stringify({ execute_error: executeResult.stderr }) + '\n');
  }
}
