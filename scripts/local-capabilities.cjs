#!/usr/bin/env node
/**
 * Local Capabilities v1
 * Observe-only local tool and model capability registry.
 *
 * Emits a single JSON object to stdout.
 * Never installs tools, never pulls models, never makes network calls.
 */

'use strict';

const { spawnSync } = require('node:child_process');

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

function safeRun(command, args) {
  for (const candidate of commandCandidates(command)) {
    const result = spawnSync(candidate, args, {
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
      error: result.status === 0 ? null : firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout) || `exit ${result.status}`,
    };
  }

  return {
    ok: false,
    stdout: '',
    stderr: '',
    error: 'not found',
  };
}

function parseOllamaModels(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  return lines
    .slice(1)
    .map((line) => line.split(/\s{2,}|\t+/)[0]?.trim())
    .filter(Boolean);
}

function detectVersionedTool(command, args = ['--version']) {
  const result = safeRun(command, args);
  if (!result.ok) {
    return {
      available: false,
      version: null,
      warning: `${command} is not available (${result.error}).`,
    };
  }

  return {
    available: true,
    version: firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr),
    warning: null,
  };
}

function detectNode() {
  return {
    available: true,
    version: process.version,
    warning: null,
  };
}

function detectPowerShell() {
  const available = process.platform === 'win32' || Boolean(process.env.PSModulePath);
  return {
    available,
    version: null,
    warning: available ? null : 'PowerShell host was not detected from the local environment.',
  };
}

function summarizeCapabilities(capabilities) {
  const criticalNames = ['node', 'pnpm', 'git'];
  const importantNames = ['ollama', 'aider'];
  const optionalNames = Object.keys(capabilities).filter(
    (name) => !criticalNames.includes(name) && !importantNames.includes(name)
  );

  const collectMissing = (names) => names.filter((name) => capabilities[name] && !capabilities[name].available);
  const criticalMissing = collectMissing(criticalNames);
  const importantMissing = collectMissing(importantNames);
  const optionalMissing = collectMissing(optionalNames);

  const status =
    criticalMissing.length > 0 ? 'FAIL' :
    importantMissing.length > 0 ? 'WARN' : 'PASS';

  return {
    status,
    critical_missing: criticalMissing,
    important_missing: importantMissing,
    optional_missing: optionalMissing,
  };
}

function buildReport() {
  const warnings = [];
  const recommendedActions = [];

  const node = detectNode();
  const pnpm = detectVersionedTool('pnpm');
  const git = detectVersionedTool('git');
  const githubCli = detectVersionedTool('gh');
  const aider = detectVersionedTool('aider');
  const powershell = detectPowerShell();
  const ollamaVersion = detectVersionedTool('ollama');

  const capabilities = {
    node: {
      available: node.available,
      version: node.version,
    },
    pnpm: {
      available: pnpm.available,
      version: pnpm.version,
    },
    git: {
      available: git.available,
      version: git.version,
    },
    github_cli: {
      available: githubCli.available,
      version: githubCli.version,
    },
    powershell: {
      available: powershell.available,
      version: powershell.version,
    },
    aider: {
      available: aider.available,
      version: aider.version,
    },
    ollama: {
      available: ollamaVersion.available,
      version: ollamaVersion.version,
      models: [],
    },
  };

  for (const warning of [
    pnpm.warning,
    git.warning,
    githubCli.warning,
    powershell.warning,
    aider.warning,
    ollamaVersion.warning,
  ]) {
    if (warning) warnings.push(warning);
  }

  if (ollamaVersion.available) {
    const ollamaList = safeRun('ollama', ['list']);
    if (ollamaList.ok) {
      capabilities.ollama.models = parseOllamaModels(ollamaList.stdout);
      if (capabilities.ollama.models.length === 0) {
        warnings.push('Ollama is available but no installed models were listed.');
      }
    } else {
      warnings.push(`Ollama is available but installed models could not be listed (${ollamaList.error}).`);
    }
  }

  const summary = summarizeCapabilities(capabilities);

  if (summary.optional_missing.includes('github_cli')) {
    recommendedActions.push('Install or expose GitHub CLI if Mission Control needs local GitHub workflow support.');
  }
  if (summary.important_missing.includes('aider')) {
    recommendedActions.push('Install or expose Aider manually before assigning local Aider-assisted coding tasks.');
  }
  if (summary.important_missing.includes('ollama')) {
    recommendedActions.push('Install or expose Ollama manually if local model routing is required.');
  } else if (capabilities.ollama.models.length === 0) {
    recommendedActions.push('Review local Ollama model availability before routing local-model tasks.');
  }
  if (summary.critical_missing.length > 0) {
    recommendedActions.unshift(`Restore critical local tooling: ${summary.critical_missing.join(', ')}.`);
  }

  if (recommendedActions.length === 0) {
    recommendedActions.push('Core local capability checks passed; Mission Control may reference these tools without auto-invoking them.');
  }

  return {
    agent: 'Local Capabilities v1',
    label: LABEL,
    status: summary.status,
    checked_at: new Date().toISOString(),
    critical_missing: summary.critical_missing,
    important_missing: summary.important_missing,
    optional_missing: summary.optional_missing,
    capabilities,
    warnings,
    recommended_actions: recommendedActions,
  };
}

function main() {
  try {
    console.log(JSON.stringify(buildReport(), null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      agent: 'Local Capabilities v1',
      label: LABEL,
      status: 'FAIL',
      checked_at: new Date().toISOString(),
      critical_missing: [],
      important_missing: [],
      optional_missing: [],
      capabilities: {},
      warnings: [`Capability detection failed: ${error instanceof Error ? error.message : String(error)}`],
      recommended_actions: ['Review scripts/local-capabilities.cjs for an unexpected runtime failure.'],
    }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  detectPowerShell,
  firstNonEmptyLine,
  parseOllamaModels,
  safeRun,
  summarizeCapabilities,
};
