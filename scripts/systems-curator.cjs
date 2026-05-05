#!/usr/bin/env node
/**
 * Systems Curator v1
 * Observe-only Mission Control implementation-gap auditor.
 *
 * Reads local repo state and emits JSON only.
 * Never mutates files, never runs installs, never makes network calls.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'OBSERVE ONLY';

const REQUIRED_DOCS = [
  'docs/mission-control/MISSION_CONTROL_ARCHITECTURE.md',
  'docs/mission-control/AGENT_REGISTRY.md',
  'docs/mission-control/SKILL_REGISTRY.md',
  'docs/mission-control/RISK_AND_APPROVAL_POLICY.md',
  'docs/mission-control/SCHEDULES.md',
  'docs/mission-control/EVIDENCE_LOG_SCHEMA.md',
  'docs/mission-control/BOT_OUTPUT_TEMPLATES.md',
];

const REQUIRED_SCRIPTS = [
  'scripts/repo-steward.cjs',
  'scripts/skill-intake.cjs',
  'scripts/mc-coordinator.cjs',
  'scripts/mc-drift.cjs',
  'scripts/mc-recommend.cjs',
  'scripts/mc-approve.cjs',
  'scripts/mc-execute.cjs',
  'scripts/mc-memory-review.cjs',
  'scripts/systems-curator.cjs',
];

const REQUIRED_ROUTES = [
  'src/app/api/bots/passive-income/route.ts',
  'src/app/api/cron/route.ts',
  'src/app/api/exec-approvals/route.ts',
  'src/app/api/memory/review/route.ts',
];

const REQUIRED_PACKAGE_SCRIPTS = [
  'repo:steward',
  'skills:intake',
  'mc:run',
  'mc:drift',
  'mc:recommend',
  'mc:approve',
  'mc:execute',
  'mc:memory-review',
];

function safeExec(command, cwd = ROOT) {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      return error.stdout.trim();
    }
    return null;
  }
}

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function collectPresence(relativePaths) {
  const present = [];
  const missing = [];

  for (const relativePath of relativePaths) {
    if (fs.existsSync(path.join(ROOT, relativePath))) present.push(relativePath);
    else missing.push(relativePath);
  }

  return { present, missing };
}

function normalizeAgentName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseDocumentedAgentNames(docText) {
  const names = [];
  const regex = /\|\s*Name\s*\|\s*`([^`]+)`\s*\|/g;
  let match;
  while ((match = regex.exec(docText)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function inspectGit() {
  const branch = safeExec('git -c core.pager=cat branch --show-current');
  const statusShort = safeExec('git -c core.pager=cat status --short');
  const latestCommits = safeExec('git -c core.pager=cat log --oneline -5');

  return {
    branch: branch || null,
    is_clean: !statusShort,
    status_short: statusShort ? statusShort.split('\n').filter(Boolean) : [],
    latest_commits: latestCommits ? latestCommits.split('\n').filter(Boolean) : [],
  };
}

function inspectPackageScriptsData(pkgJson) {
  const scripts = pkgJson?.scripts || {};
  const present = [];
  const missing = [];
  const brokenTargets = [];

  for (const name of REQUIRED_PACKAGE_SCRIPTS) {
    if (Object.prototype.hasOwnProperty.call(scripts, name)) present.push(name);
    else missing.push(name);
  }

  for (const [name, command] of Object.entries(scripts)) {
    const match = String(command).match(/\bnode\s+(scripts\/[^\s"'`]+)/);
    if (!match) continue;
    const relativeScript = match[1].replace(/\//g, path.sep);
    const fullPath = path.join(ROOT, relativeScript);
    if (!fs.existsSync(fullPath)) {
      brokenTargets.push({ script: name, target: match[1] });
    }
  }

  return {
    detected: Object.keys(scripts),
    required_present: present,
    required_missing: missing,
    broken_targets: brokenTargets,
  };
}

function inspectRegistry(agentRegistryDocText) {
  const registryPath = 'data/mission-control/agent-registry.json';
  const registryExists = fs.existsSync(path.join(ROOT, registryPath));
  const registry = registryExists ? readJson(registryPath) : { agents: [] };
  const runtimeAgents = Array.isArray(registry.agents) ? registry.agents : [];
  const runtimeIds = runtimeAgents.map((agent) => agent.id || agent.name || '(unnamed)');

  const documentedAgentNames = parseDocumentedAgentNames(agentRegistryDocText);
  const runtimeNameSet = new Set(
    runtimeAgents.flatMap((agent) => [normalizeAgentName(agent.id), normalizeAgentName(agent.name)])
  );
  const documentedMissingFromRuntime = documentedAgentNames.filter((name) => {
    const normalized = normalizeAgentName(name);
    return normalized && !runtimeNameSet.has(normalized);
  });

  const systemsCuratorEntry = runtimeAgents.find((agent) => normalizeAgentName(agent.id) === 'systemscurator');
  // Coordinator-runnable agents (enabled:true) require command, observe_only, and timeout_ms.
  // Disabled or PLANNED agents only require id and enabled.
  const malformedAgents = runtimeAgents
    .filter((agent) => {
      if (!agent.id || typeof agent.enabled !== 'boolean') return true;
      if (agent.enabled) {
        return !Array.isArray(agent.command) || typeof agent.observe_only !== 'boolean';
      }
      return false;
    })
    .map((agent) => agent.id || agent.name || '(unnamed)');

  return {
    exists: registryExists,
    path: registryPath,
    runtime_ids: runtimeIds,
    documented_agents: documentedAgentNames,
    documented_missing_from_runtime: documentedMissingFromRuntime,
    systems_curator_registered: Boolean(systemsCuratorEntry),
    systems_curator_observe_only: systemsCuratorEntry ? systemsCuratorEntry.observe_only === true : false,
    malformed_agents: malformedAgents,
  };
}

function detectScheduleMismatch(scheduleDocText, cronRouteText) {
  const saysDb = /stored in the Mission Control database/i.test(scheduleDocText);
  const usesOpenClaw = /openclaw.*cron.*jobs\.json|cron.*jobs\.json/i.test(cronRouteText);
  if (saysDb && usesOpenClaw) {
    return 'docs/mission-control/SCHEDULES.md says cron jobs live in the Mission Control database, but src/app/api/cron/route.ts reads ~/.openclaw/cron/jobs.json.';
  }
  return null;
}

function detectUnsafeExecutionPaths(relativePath, sourceText) {
  const findings = [];
  if (/unlinkSync\s*\(/.test(sourceText)) {
    findings.push(`${relativePath} contains fs.unlinkSync, which is a real file-deletion execution path.`);
  }
  if (/rmSync\s*\(/.test(sourceText)) {
    findings.push(`${relativePath} contains fs.rmSync, which is a destructive execution path.`);
  }
  return findings;
}

function buildWarnings(report) {
  const warnings = [];

  if (!report.git.is_clean) {
    warnings.push('Working tree has uncommitted changes.');
  }

  if (report.docs.missing.length > 0) {
    warnings.push(`Missing required Mission Control docs: ${report.docs.missing.join(', ')}.`);
  }

  if (report.scripts.missing.length > 0) {
    warnings.push(`Missing expected Mission Control scripts: ${report.scripts.missing.join(', ')}.`);
  }

  if (report.routes.missing.length > 0) {
    warnings.push(`Missing expected Mission Control routes: ${report.routes.missing.join(', ')}.`);
  }

  if (report.package_scripts.required_missing.length > 0) {
    warnings.push(`Missing expected package scripts: ${report.package_scripts.required_missing.join(', ')}.`);
  }

  for (const broken of report.package_scripts.broken_targets) {
    warnings.push(`Package script "${broken.script}" points to missing file ${broken.target}.`);
  }

  if (!report.registry.exists) {
    warnings.push('data/mission-control/agent-registry.json is missing.');
  }

  if (!report.registry.systems_curator_registered) {
    warnings.push('Systems Curator is not registered in data/mission-control/agent-registry.json.');
  } else if (!report.registry.systems_curator_observe_only) {
    warnings.push('Systems Curator registry entry is not observe_only: true.');
  }

  if (report.registry.documented_missing_from_runtime.length > 0) {
    warnings.push(`Documented agents missing from runtime registry: ${report.registry.documented_missing_from_runtime.join(', ')}.`);
  }

  if (report.registry.malformed_agents.length > 0) {
    warnings.push(`Malformed registry agent entries: ${report.registry.malformed_agents.join(', ')}.`);
  }

  for (const mismatch of report.mismatches) {
    warnings.push(mismatch);
  }

  for (const finding of report.unsafe_mutable_paths) {
    warnings.push(finding);
  }

  return warnings;
}

function buildRecommendedNextActions(report, warnings) {
  const actions = [];

  if (!report.git.is_clean) {
    actions.push('Review the working tree and isolate unrelated changes before expanding Mission Control further.');
  }

  if (report.package_scripts.required_missing.includes('mc:memory-review')) {
    actions.push('Expose mc-memory-review through package.json so the documented script path is real.');
  }

  if (report.package_scripts.broken_targets.length > 0) {
    actions.push('Fix or remove package scripts that point to missing files, starting with scripts/agent-loop.cjs references.');
  }

  if (report.registry.documented_missing_from_runtime.length > 0) {
    actions.push('Reconcile docs/mission-control/AGENT_REGISTRY.md with data/mission-control/agent-registry.json so the runtime registry matches the documented system.');
  }

  if (report.mismatches.length > 0) {
    actions.push('Reconcile scheduling docs and runtime behavior before activating more cron-driven Mission Control jobs.');
  }

  if (report.unsafe_mutable_paths.length > 0) {
    actions.push('Put routing-validation enforcement in front of mutable Mission Control execution paths before adding more agents.');
  }

  if (actions.length === 0 && warnings.length === 0) {
    actions.push('Mission Control observe-only wiring looks coherent. Keep new agents read-only until approval enforcement is unified.');
  }

  return actions;
}

function computeStatusAndRisk(warnings, unsafeMutablePaths, mismatches, brokenTargets) {
  let riskLevel = 0;

  if (warnings.length > 0) riskLevel = 1;
  if (mismatches.length > 0 || brokenTargets.length > 0) riskLevel = Math.max(riskLevel, 2);
  if (unsafeMutablePaths.length > 0) riskLevel = Math.max(riskLevel, 2);

  const status = riskLevel >= 2 ? 'FAIL' : riskLevel === 1 ? 'WARN' : 'OK';
  return { status, risk_level: riskLevel };
}

function run(root = ROOT) {
  if (path.resolve(root) !== ROOT) {
    throw new Error('Systems Curator currently supports the checked-out repo root only.');
  }

  const git = inspectGit();
  const docs = collectPresence(REQUIRED_DOCS);
  const scripts = collectPresence(REQUIRED_SCRIPTS);
  const routes = collectPresence(REQUIRED_ROUTES);
  const packageJson = readJson('package.json');
  const packageScripts = inspectPackageScriptsData(packageJson);
  const agentRegistryDocText = readText('docs/mission-control/AGENT_REGISTRY.md');
  const scheduleDocText = readText('docs/mission-control/SCHEDULES.md');
  const blockersText = fs.existsSync(path.join(ROOT, 'BLOCKERS.md')) ? readText('BLOCKERS.md') : '';
  const cronRouteText = readText('src/app/api/cron/route.ts');
  const executeScriptText = readText('scripts/mc-execute.cjs');
  const registry = inspectRegistry(agentRegistryDocText);

  const mismatches = [];
  const scheduleMismatch = detectScheduleMismatch(scheduleDocText, cronRouteText);
  if (scheduleMismatch) mismatches.push(scheduleMismatch);

  if (/Added `"mc:memory-review"/.test(blockersText) && !packageScripts.detected.includes('mc:memory-review')) {
    mismatches.push('BLOCKERS.md says mc-memory-review is exposed in package.json, but that package script is missing.');
  }
  if (/calls\s+GET \/api\/memory\/review/i.test(blockersText) && /db\.prepare\(/i.test(readText('scripts/mc-memory-review.cjs'))) {
    mismatches.push('BLOCKERS.md says mc-memory-review calls GET /api/memory/review, but scripts/mc-memory-review.cjs currently reads SQLite directly.');
  }

  const unsafeMutablePaths = detectUnsafeExecutionPaths('scripts/mc-execute.cjs', executeScriptText);

  const report = {
    agent: 'Systems Curator v1',
    label: LABEL,
    timestamp: new Date().toISOString(),
    git,
    docs,
    scripts,
    routes,
    package_scripts: packageScripts,
    registry,
    coordinator: {
      script_exists: fs.existsSync(path.join(ROOT, 'scripts/mc-coordinator.cjs')),
      package_script_present: packageScripts.detected.includes('mc:run'),
      registry_path: registry.path,
      enabled_observe_only_agents: registry.runtime_ids,
    },
    mismatches,
    unsafe_mutable_paths: unsafeMutablePaths,
  };

  const warnings = buildWarnings(report);
  const recommendedNextActions = buildRecommendedNextActions(report, warnings);
  const { status, risk_level } = computeStatusAndRisk(
    warnings,
    report.unsafe_mutable_paths,
    report.mismatches,
    report.package_scripts.broken_targets
  );

  return {
    status,
    risk_level,
    label: LABEL,
    timestamp: report.timestamp,
    current_branch: report.git.branch,
    git_status_short: report.git.status_short,
    latest_commits: report.git.latest_commits,
    docs_present: report.docs.present,
    docs_missing: report.docs.missing,
    registry: report.registry,
    coordinator: report.coordinator,
    package_scripts: report.package_scripts,
    scripts_present: report.scripts.present,
    scripts_missing: report.scripts.missing,
    routes_present: report.routes.present,
    routes_missing: report.routes.missing,
    mismatches: report.mismatches,
    unsafe_mutable_paths: report.unsafe_mutable_paths,
    warnings,
    recommended_next_actions: recommendedNextActions,
  };
}

module.exports = {
  run,
  normalizeAgentName,
  parseDocumentedAgentNames,
  inspectPackageScriptsData,
  detectScheduleMismatch,
  detectUnsafeExecutionPaths,
  buildWarnings,
  buildRecommendedNextActions,
};

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(run(), null, 2) + '\n');
    process.exit(0);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'FAIL',
      risk_level: 3,
      label: LABEL,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2) + '\n');
    process.exit(1);
  }
}
