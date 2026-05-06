#!/usr/bin/env node
/**
 * PR Reviewer Bot v1
 * Observe-only PR review, risk classification, and reviewer comment generation.
 *
 * Reads PR metadata via gh CLI or GitHub public API.
 * Classifies changed files by risk, scans diff for red flags,
 * runs local validation suite, emits structured JSON + Markdown comment.
 * Never merges, commits, pushes, or modifies any file.
 *
 * Usage:
 *   node scripts/pr-reviewer.cjs --repo owner/repo --pr 123
 *   node scripts/pr-reviewer.cjs --repo owner/repo --pr 123 --post-comment
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'OBSERVE ONLY';
const IS_WIN = process.platform === 'win32';
const PNPM = IS_WIN ? 'pnpm.cmd' : 'pnpm';

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    repo: null,
    pr: null,
    postComment: false,
    skipValidation: false,
    merge: false,
    autoMerge: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i] ?? null;
    else if (a === '--pr') args.pr = Number(argv[++i]) || null;
    else if (a === '--post-comment') args.postComment = true;
    else if (a === '--skip-validation') args.skipValidation = true;
    else if (a === '--merge') args.merge = true;
    else if (a === '--auto-merge') args.autoMerge = true;
  }
  return args;
}

// ── Merge refusal ─────────────────────────────────────────────────────────────

function checkMergeRefusal(args) {
  if (args.merge || args.autoMerge) {
    const flag = args.merge ? '--merge' : '--auto-merge';
    return { refused: true, flag };
  }
  return { refused: false, flag: null };
}

// ── gh CLI availability ───────────────────────────────────────────────────────

function isGhAvailable() {
  const r = spawnSync('gh', ['--version'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
  return r.status === 0;
}

function isGhAuthenticated() {
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
  return r.status === 0;
}

// ── gh CLI PR fetch ───────────────────────────────────────────────────────────

function fetchPrMetaViaGh(repo, prNumber) {
  const r = spawnSync('gh', [
    'pr', 'view', String(prNumber), '--repo', repo,
    '--json', 'title,body,state,baseRefName,headRefName,additions,deletions,changedFiles,mergeable,author,number,url',
  ], { encoding: 'utf-8', stdio: 'pipe', timeout: 20000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function fetchPrFilesViaGh(repo, prNumber) {
  const r = spawnSync('gh', [
    'pr', 'view', String(prNumber), '--repo', repo, '--json', 'files',
  ], { encoding: 'utf-8', stdio: 'pipe', timeout: 20000 });
  if (r.status !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed.files) ? parsed.files : null;
  } catch { return null; }
}

function fetchPrDiffViaGh(repo, prNumber) {
  const r = spawnSync('gh', [
    'pr', 'diff', String(prNumber), '--repo', repo,
  ], { encoding: 'utf-8', stdio: 'pipe', timeout: 20000 });
  if (r.status !== 0) return null;
  return r.stdout || null;
}

function resolveFetchedHeadSha() {
  const r = spawnSync('git', ['rev-parse', 'FETCH_HEAD'], {
    encoding: 'utf-8', stdio: 'pipe', timeout: 30000, cwd: ROOT,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.trim();
}

function fetchPrDiffViaGit(baseRef, headRef) {
  if (!baseRef || !headRef) return null;
  const fetchBase = spawnSync('git', ['fetch', 'origin', baseRef], {
    encoding: 'utf-8', stdio: 'pipe', timeout: 30000, cwd: ROOT,
  });
  if (fetchBase.status !== 0) return null;
  const baseSha = resolveFetchedHeadSha();
  if (!baseSha) return null;

  const fetchHead = spawnSync('git', ['fetch', 'origin', headRef], {
    encoding: 'utf-8', stdio: 'pipe', timeout: 30000, cwd: ROOT,
  });
  if (fetchHead.status !== 0) return null;
  const headSha = resolveFetchedHeadSha();
  if (!headSha) return null;

  const r = spawnSync('git', ['diff', `${baseSha}...${headSha}`], {
    encoding: 'utf-8', stdio: 'pipe', timeout: 30000, cwd: ROOT,
  });
  if (r.status === 0 && r.stdout) return r.stdout;

  const fallback = spawnSync('git', ['diff', baseSha, headSha], {
    encoding: 'utf-8', stdio: 'pipe', timeout: 30000, cwd: ROOT,
  });
  if (fallback.status !== 0 || !fallback.stdout) return null;
  return fallback.stdout;
}

// ── GitHub REST API fallback ──────────────────────────────────────────────────

function fetchViaApi(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method: 'GET',
      headers: {
        'User-Agent': 'mission-control-pr-reviewer-bot/1',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    req.end();
  });
}

async function fetchPrMetaViaApi(repo, prNumber) {
  try {
    const { status, body } = await fetchViaApi(`/repos/${repo}/pulls/${prNumber}`);
    if (status !== 200 || typeof body !== 'object') return null;
    return {
      number: body.number,
      title: body.title,
      body: body.body,
      state: body.state,
      baseRefName: body.base?.ref,
      headRefName: body.head?.ref,
      additions: body.additions,
      deletions: body.deletions,
      changedFiles: body.changed_files,
      mergeable: body.mergeable,
      author: body.user?.login,
      url: body.html_url,
    };
  } catch { return null; }
}

async function fetchPrFilesViaApi(repo, prNumber) {
  try {
    const { status, body } = await fetchViaApi(`/repos/${repo}/pulls/${prNumber}/files?per_page=100`);
    if (status !== 200 || !Array.isArray(body)) return null;
    return body.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions, status: f.status }));
  } catch { return null; }
}

// ── File classification ───────────────────────────────────────────────────────

const RISK_RULES = [
  { pattern: /^scripts\//, category: 'scripts', risk: 'high' },
  { pattern: /^src\/app\/api\//, category: 'api-routes', risk: 'high' },
  { pattern: /package\.json$|pnpm-lock\.yaml$|\.npmrc$/, category: 'dependencies', risk: 'high' },
  { pattern: /(^|\/)\.(env)(\.|$)/, category: 'config', risk: 'high' },
  { pattern: /data\/mission-control\/agent-registry\.json/, category: 'registry', risk: 'high' },
  // Test files before auth/lib patterns so auth.test.ts isn't misclassified as auth
  { pattern: /\.(test|spec)\.[jt]sx?$/, category: 'tests', risk: 'low' },
  { pattern: /\/middleware\.ts$|\/middleware\/|\/auth\.ts$|\/auth\/|\/security\.ts$|\/security\//, category: 'auth', risk: 'high' },
  { pattern: /src\/lib\//, category: 'lib', risk: 'medium' },
  { pattern: /src\/components\//, category: 'components', risk: 'low' },
  { pattern: /^docs\/|\.md$/, category: 'docs', risk: 'low' },
  { pattern: /\.(yml|yaml)$/, category: 'config', risk: 'medium' },
  { pattern: /Dockerfile|docker-compose/, category: 'infra', risk: 'medium' },
];

function classifyFile(filePath) {
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(filePath)) {
      return { category: rule.category, risk: rule.risk };
    }
  }
  return { category: 'other', risk: 'low' };
}

function classifyContextType(filePath) {
  if (!filePath) return 'unknown';
  if (filePath === 'scripts/pr-reviewer.cjs') return 'tooling/reviewer-self';
  if (/^docs\/|\.md$/i.test(filePath)) return 'docs';
  if (/(^|\/)__tests__\/|(\.test|\.spec)\.[jt]sx?$/i.test(filePath)) return 'test';
  if (/package\.json$|pnpm-lock\.yaml$|\.npmrc$|(^|\/)\.(env)(\.|$)|\.(yml|yaml)$|Dockerfile|docker-compose/i.test(filePath)) {
    return 'config';
  }
  return 'production';
}

function hasProductionImpact(contextType) {
  return contextType === 'production' || contextType === 'config';
}

const STRICT_ZONE_PATTERNS = [
  /^scripts\//,
  /^src\/app\/api\//,
  /execution|gate|approval/i,
];

function isStrictZone(filePath) {
  return STRICT_ZONE_PATTERNS.some((p) => p.test(filePath));
}

// ── Red flag detection ────────────────────────────────────────────────────────

const RED_FLAG_PATTERNS = [
  {
    name: 'filesystem-mutation',
    pattern: /fs\.(unlink|rm|write|append|truncate)(Sync)?\s*\(/,
    severity: 'high',
  },
  {
    name: 'shell-execution',
    pattern: /\bexecSync\s*\(|\bspawnSync\s*\(|\bexec\s*\(|\bspawn\s*\(|require\s*\(\s*['"]child_process['"]/,
    severity: 'high',
  },
  {
    name: 'dynamic-execution',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    severity: 'critical',
  },
  {
    name: 'network-call',
    pattern: /\bfetch\s*\(|axios\.|https?\.(get|post|request)\s*\(|new\s+XMLHttpRequest/,
    severity: 'medium',
  },
  {
    name: 'auth-bypass',
    pattern: /skipAuth|bypass[_\s-]?auth|isAuthenticated\s*[=!]=\s*false/i,
    severity: 'critical',
  },
  {
    name: 'approval-bypass',
    pattern: /skipApproval|auto[_\s-]?approve|approval[_\s-]?bypass|skip[_\s-]?gate/i,
    severity: 'critical',
  },
  {
    name: 'default-allow',
    pattern: /default[_\s-]?allow\b|allowAll\b/i,
    severity: 'high',
  },
  {
    name: 'secrets-in-code',
    pattern: /(?:KEY|SECRET|TOKEN|PASSWORD|PASS|API_KEY)\s*=\s*['"`][^'"`\s]{6,}/,
    severity: 'critical',
  },
  {
    name: 'tests-removed',
    pattern: /^\s*(it|describe|test)\s*\(/,
    severity: 'medium',
  },
  {
    name: 'new-dependency',
    pattern: /^\s*"(?!@types\/)[a-z@][a-z0-9/@._-]+"\s*:/,
    severity: 'medium',
  },
];

function parseDiffLines(diff) {
  const entries = [];
  const lines = diff.split('\n');
  let currentFile = null;
  let pendingOldPath = null;
  let pendingNewPath = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git ')) {
      currentFile = null;
      pendingOldPath = null;
      pendingNewPath = null;
      inHunk = false;
      continue;
    }

    if (rawLine.startsWith('--- ')) {
      const source = rawLine.slice(4).trim();
      pendingOldPath = source === '/dev/null' ? null : source.replace(/^a\//, '');
      continue;
    }

    if (rawLine.startsWith('+++ ')) {
      const source = rawLine.slice(4).trim();
      pendingNewPath = source === '/dev/null' ? null : source.replace(/^b\//, '');
      currentFile = pendingNewPath || pendingOldPath;
      continue;
    }

    if (rawLine.startsWith('@@ ')) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) {
        inHunk = false;
        continue;
      }
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile || rawLine === '\\ No newline at end of file') {
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      entries.push({
        kind: 'add',
        path: currentFile,
        line: newLine,
        text: rawLine.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      entries.push({
        kind: 'remove',
        path: currentFile,
        line: oldLine,
        text: rawLine.slice(1),
      });
      oldLine += 1;
      continue;
    }

    oldLine += 1;
    newLine += 1;
  }

  return entries;
}

function buildFindingMessage(flag, entry, contextType) {
  const location = entry.path ? `${entry.path}:${entry.line}` : 'unknown location';
  if (contextType === 'tooling/reviewer-self') {
    return `${flag} pattern matched in reviewer tooling at ${location}`;
  }
  if (contextType === 'test') {
    return `${flag} pattern matched in test fixture at ${location}`;
  }
  if (contextType === 'docs') {
    return `${flag} pattern matched in documentation/example text at ${location}`;
  }
  if (contextType === 'config') {
    return `${flag} pattern matched in configuration at ${location}`;
  }
  return `${flag} pattern matched in production code at ${location}`;
}

function buildAllowedFindingMessage(flag, entry, allowReason) {
  const location = entry.path ? `${entry.path}:${entry.line}` : 'unknown location';
  return `${flag} matched an allowlisted local Mission Control pattern at ${location} (${allowReason})`;
}

function getFileEntryText(entries, kind) {
  return entries
    .filter((entry) => !kind || entry.kind === kind)
    .map((entry) => entry.text)
    .join('\n');
}

function tryReadRepoFile(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
  } catch {
    return '';
  }
}

function classifyShellExecutionAllowance(entry, fileEntries) {
  if (!entry || entry.flag !== 'shell-execution' || entry.context_type !== 'production') {
    return { allowed: false, allow_reason: null };
  }

  if (/^src\/app\/api\//.test(entry.path || '')) {
    return { allowed: false, allow_reason: null };
  }

  const addedText = getFileEntryText(fileEntries, 'add');

  if (entry.path === 'scripts/mission-control-preflight.cjs') {
    const fileText = tryReadRepoFile(entry.path);
    const diffShowsStdio = /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/.test(addedText);
    const diffShowsTimeout = /timeout:\s*5000/.test(addedText);
    const canUseFileFallback = !diffShowsStdio && !diffShowsTimeout;
    const hasSafeStdio = diffShowsStdio || (canUseFileFallback && /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/.test(fileText));
    const hasSafeTimeout = diffShowsTimeout || (canUseFileFallback && /timeout:\s*5000/.test(fileText));
    const isAllowlisted =
      /spawnSync\(candidate,\s*args,\s*\{/.test(entry.text) &&
      /for\s*\(const candidate of commandCandidates\(command\)\)/.test(addedText) &&
      /shell:\s*useShellForCandidate\(candidate\)/.test(addedText) &&
      hasSafeStdio &&
      hasSafeTimeout &&
      /windowsHide:\s*true/.test(addedText) &&
      /function defaultRunCommand/.test(addedText);

    return {
      allowed: isAllowlisted,
      allow_reason: isAllowlisted
        ? 'bounded local preflight probe over a controlled command candidate list'
        : null,
    };
  }

  if (entry.path === 'scripts/mc-coordinator.cjs') {
    const fileText = tryReadRepoFile(entry.path);
    const diffShowsStdio = /stdio:\s*\['pipe',\s*'pipe',\s*'pipe'\]/.test(addedText);
    const diffShowsTimeout = /timeout:\s*30000/.test(addedText);
    const canUseFileFallback = !diffShowsStdio && !diffShowsTimeout;
    const hasSafeStdio = diffShowsStdio || (canUseFileFallback && /stdio:\s*\['pipe',\s*'pipe',\s*'pipe'\]/.test(fileText));
    const hasSafeTimeout = diffShowsTimeout || (canUseFileFallback && /timeout:\s*30000/.test(fileText));
    const hasLocalRootCwd = /cwd:\s*ROOT/.test(addedText) || /cwd:\s*ROOT/.test(fileText);
    const isAllowlisted =
      /spawnSync\('node'/.test(entry.text) &&
      /path\.join\(__dirname,\s*'mc-execute\.cjs'\)/.test(addedText) &&
      /'--apply-approved'/.test(addedText) &&
      /if\s*\(executeRequested && preflightResult\.status !== 'FAIL'\)/.test(addedText) &&
      hasLocalRootCwd &&
      hasSafeStdio &&
      hasSafeTimeout;

    return {
      allowed: isAllowlisted,
      allow_reason: isAllowlisted
        ? 'bounded local Mission Control orchestration of mc-execute with explicit apply approval'
        : null,
    };
  }

  return { allowed: false, allow_reason: null };
}

function scanRedFlags(diff) {
  if (!diff) {
    return [{
      flag: 'diff-unavailable',
      severity: 'critical',
      path: null,
      line: null,
      context_type: 'unknown',
      production_impact: true,
      allowed: false,
      allow_reason: null,
      requires_human_review: true,
      message: 'PR diff could not be inspected; red-flag scan is incomplete.',
      excerpt: null,
    }];
  }
  const entries = parseDiffLines(diff);
  if (entries.length === 0) {
    return [{
      flag: 'diff-unavailable',
      severity: 'critical',
      path: null,
      line: null,
      context_type: 'unknown',
      production_impact: true,
      allowed: false,
      allow_reason: null,
      requires_human_review: true,
      message: 'PR diff could not be inspected; red-flag scan is incomplete.',
      excerpt: null,
    }];
  }

  const findings = [];
  const entriesByPath = new Map();

  for (const entry of entries) {
    if (!entriesByPath.has(entry.path)) {
      entriesByPath.set(entry.path, []);
    }
    entriesByPath.get(entry.path).push(entry);
  }

  for (const entry of entries) {
    const contextType = classifyContextType(entry.path);
    const productionImpact = hasProductionImpact(contextType);

    for (const { name, pattern, severity } of RED_FLAG_PATTERNS) {
      const shouldScan = name === 'tests-removed' ? entry.kind === 'remove' : entry.kind === 'add';
      if (!shouldScan) continue;
      if (!pattern.test(entry.text)) continue;

      const allowance = classifyShellExecutionAllowance({
        flag: name,
        path: entry.path,
        context_type: contextType,
        text: entry.text,
      }, entriesByPath.get(entry.path) || []);
      const productionImpactAfterAllowance = productionImpact && !allowance.allowed;

      findings.push({
        flag: name,
        severity,
        path: entry.path,
        line: entry.line,
        context_type: contextType,
        production_impact: productionImpactAfterAllowance,
        allowed: allowance.allowed,
        allow_reason: allowance.allow_reason,
        requires_human_review: productionImpactAfterAllowance,
        message: allowance.allowed
          ? buildAllowedFindingMessage(name, entry, allowance.allow_reason)
          : buildFindingMessage(name, entry, contextType),
        excerpt: entry.text.slice(0, 120),
      });
    }
  }

  return findings;
}

// ── Local validation ──────────────────────────────────────────────────────────

function runValidation(skipValidation = false) {
  if (skipValidation) {
    return {
      passed: true,
      skipped: true,
      steps: [
        { step: 'typecheck', passed: true, skipped: true, duration_ms: 0 },
        { step: 'test', passed: true, skipped: true, duration_ms: 0 },
        { step: 'build', passed: true, skipped: true, duration_ms: 0 },
        { step: 'systems-curator', passed: true, skipped: true, duration_ms: 0 },
        { step: 'mc-coordinator', passed: true, skipped: true, duration_ms: 0 },
      ],
    };
  }

  const steps = [];

  function runStep(label, cmd, args, opts = {}) {
    const start = Date.now();
    const r = spawnSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: opts.timeout || 120000,
      env: { ...process.env, ...(opts.env || {}) },
      // .cmd files on Windows require shell:true
      ...(IS_WIN && cmd === PNPM ? { shell: true } : {}),
    });
    const duration_ms = Date.now() - start;
    const passed = r.status === 0 && !r.error;
    steps.push({
      step: label,
      passed,
      exit_code: r.status,
      duration_ms,
      ...(r.error ? { error: r.error.message } : {}),
      ...(r.stderr && !passed ? { stderr_excerpt: r.stderr.slice(0, 400) } : {}),
    });
    return passed;
  }

  runStep('typecheck', PNPM, ['run', 'typecheck'], { timeout: 90000 });
  runStep('test', PNPM, ['test', '--run'], {
    timeout: 360000,
    env: { NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  runStep('build', PNPM, ['run', 'build'], { timeout: 360000 });
  runStep('systems-curator', 'node', ['scripts/systems-curator.cjs'], { timeout: 30000 });
  runStep('mc-coordinator', 'node', ['scripts/mc-coordinator.cjs'], { timeout: 90000 });

  return { passed: steps.every((s) => s.passed), skipped: false, steps };
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function summarizeFlags(flags) {
  const counts = new Map();
  for (const flag of flags) {
    counts.set(flag.flag, (counts.get(flag.flag) || 0) + 1);
  }
  return [...counts.entries()].map(([flag, count]) => ({ flag, count }));
}

function buildVerdict(files, redFlags, validation) {
  const diffUnavailable = redFlags.some((f) => f.flag === 'diff-unavailable');
  const productionFlags = redFlags.filter((f) => f.production_impact === true);
  const nonProductionFlags = redFlags.filter((f) => f.production_impact === false);
  const allowedFlags = redFlags.filter((f) => f.allowed === true);
  const criticalFlags = productionFlags.filter((f) => f.severity === 'critical');
  const highFlags = productionFlags.filter((f) => f.severity === 'high');
  const highRiskFiles = files.filter((f) => f.risk === 'high');
  const failedSteps = (validation.steps || []).filter((s) => !s.passed && !s.skipped);

  const reasons = [];
  const summarizedCritical = summarizeFlags(criticalFlags);
  const summarizedHigh = summarizeFlags(highFlags);
  const summarizedNonProd = summarizeFlags(nonProductionFlags);
  const summarizedAllowed = summarizeFlags(allowedFlags);

  if (diffUnavailable) {
    reasons.push('PR diff could not be inspected');
    return {
      status: 'FAIL',
      risk_level: 3,
      recommendation: 'BLOCK — insufficient data, diff inspection failed',
      reasons,
    };
  }

  if (failedSteps.length > 0) {
    reasons.push(`Validation failed: ${failedSteps.map((s) => s.step).join(', ')}`);
    return {
      status: 'FAIL',
      risk_level: 3,
      recommendation: 'BLOCK — validation failed',
      reasons,
    };
  }

  if (summarizedCritical.length > 0) {
    reasons.push(`${criticalFlags.length} critical production red flag(s): ${summarizedCritical.map((f) => `${f.flag} (${f.count})`).join(', ')}`);
    return {
      status: 'FAIL',
      risk_level: 3,
      recommendation: 'BLOCK — production-impacting critical issues require human review before merge',
      reasons,
    };
  }

  if (summarizedHigh.length > 0) {
    reasons.push(`${highFlags.length} high-severity production red flag(s): ${summarizedHigh.map((f) => `${f.flag} (${f.count})`).join(', ')}`);
    return {
      status: 'FAIL',
      risk_level: 2,
      recommendation: 'BLOCK — production-impacting high-risk issues require human review before merge',
      reasons,
    };
  }

  if (summarizedNonProd.length > 0) {
    reasons.push(`${nonProductionFlags.length} non-production finding(s): ${summarizedNonProd.map((f) => `${f.flag} (${f.count})`).join(', ')}`);
  }
  if (summarizedAllowed.length > 0) {
    reasons.push(`${allowedFlags.length} allowlisted local execution finding(s): ${summarizedAllowed.map((f) => `${f.flag} (${f.count})`).join(', ')}`);
  }
  if (highRiskFiles.length > 0) {
    reasons.push(`${highRiskFiles.length} high-risk file(s) modified`);
  }

  if (reasons.length > 0) {
    return {
      status: 'WARN',
      risk_level: 1,
      recommendation: 'SAFE WITH NOTES — no production-impacting red flags detected',
      reasons,
    };
  }

  return {
    status: 'OK',
    risk_level: 0,
    recommendation: 'LGTM — no production-impacting issues detected',
    reasons,
  };
}

// ── Markdown comment ──────────────────────────────────────────────────────────

function buildMarkdownComment(report) {
  const { pr_meta, file_summary, red_flags, validation, verdict, pr } = report;
  const rl = verdict.risk_level;
  const icon = rl >= 3 ? '🔴' : rl >= 1 ? '🟡' : '🟢';
  const productionFlags = (red_flags || []).filter((f) => f.production_impact === true);
  const allowedFlags = (red_flags || []).filter((f) => f.allowed === true);
  const nonProductionFlags = (red_flags || []).filter((f) => f.production_impact === false);
  const lines = [];

  lines.push(`## ${icon} PR Review — Mission Control Bot (Observe-Only)`);
  lines.push('');

  if (pr_meta) {
    lines.push(`**PR**: #${pr_meta.number} — ${pr_meta.title}`);
    const author = typeof pr_meta.author === 'object' ? pr_meta.author?.login : pr_meta.author;
    lines.push(`**State**: \`${pr_meta.state}\` | **Author**: ${author ?? 'unknown'}`);
    const fileCount = pr_meta.changedFiles ?? file_summary?.total ?? '?';
    lines.push(`**Changes**: +${pr_meta.additions} / -${pr_meta.deletions} across ${fileCount} file(s)`);
  } else {
    lines.push(`**PR**: ${pr?.repo ?? '?'}#${pr?.number ?? '?'} (metadata unavailable)`);
  }
  lines.push('');

  const diffUnavailable = (red_flags || []).some((f) => f.flag === 'diff-unavailable');
  if (diffUnavailable) {
    lines.push('> ⚠️ **INCOMPLETE REVIEW** — PR diff could not be inspected. Red-flag scan is incomplete. Do not treat this as a clean review.');
    lines.push('');
  }

  lines.push('### Merge Verdict');
  lines.push(`${verdict.recommendation}`);
  lines.push(`**Risk level**: ${verdict.risk_level}/3 | **Status**: \`${verdict.status}\``);
  if (verdict.reasons.length > 0) {
    lines.push('');
    for (const r of verdict.reasons) lines.push(`- ${r}`);
  }
  lines.push('');

  if (file_summary && file_summary.files && file_summary.files.length > 0) {
    lines.push('### Changed Files by Risk');
    const byRisk = { high: [], medium: [], low: [] };
    for (const f of file_summary.files) {
      const bucket = f.risk === 'high' ? 'high' : f.risk === 'medium' ? 'medium' : 'low';
      byRisk[bucket].push(f.path);
    }
    if (byRisk.high.length > 0) {
      lines.push(`**High** (${byRisk.high.length}):`);
      for (const f of byRisk.high) lines.push(`- \`${f}\``);
    }
    if (byRisk.medium.length > 0) {
      lines.push(`**Medium** (${byRisk.medium.length}):`);
      for (const f of byRisk.medium) lines.push(`- \`${f}\``);
    }
    if (byRisk.low.length > 0) {
      lines.push(`**Low**: ${byRisk.low.length} file(s)`);
    }
    lines.push('');
  }

  lines.push('### Production Red Flags');
  if (productionFlags.length === 0) {
    lines.push('- None detected');
  } else {
    for (const flag of productionFlags) {
      lines.push(`- **${flag.flag}** (${flag.severity}) — \`${flag.path}:${flag.line}\` — ${flag.message}`);
      if (flag.excerpt) lines.push(`  \`${flag.excerpt}\``);
    }
  }
  lines.push('');

  lines.push('### Allowed Local Command Execution Findings');
  if (allowedFlags.length === 0) {
    lines.push('- None detected');
  } else {
    for (const flag of allowedFlags) {
      lines.push(`- **${flag.flag}** (${flag.severity}) — \`${flag.path}:${flag.line}\` — ${flag.allow_reason}`);
      if (flag.excerpt) lines.push(`  \`${flag.excerpt}\``);
    }
  }
  lines.push('');

  lines.push('### Non-production/Test Fixture Findings');
  if (nonProductionFlags.length === 0) {
    lines.push('- None detected');
  } else {
    for (const flag of nonProductionFlags) {
      lines.push(`- **${flag.flag}** (${flag.severity}) — \`${flag.path}:${flag.line}\` — ${flag.context_type}`);
      if (flag.excerpt) lines.push(`  \`${flag.excerpt}\``);
    }
  }
  lines.push('');

  if (validation) {
    lines.push('### Validation Results');
    if (validation.skipped) {
      lines.push('- ⏭ validation skipped');
    } else {
      for (const step of (validation.steps || [])) {
        const stepIcon = step.passed ? '✅' : '❌';
        lines.push(`- ${stepIcon} \`${step.step}\` (${step.duration_ms}ms)`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*PR Reviewer Bot v1 — OBSERVE ONLY — no merge capability*');

  return lines.join('\n');
}

// ── Post comment ──────────────────────────────────────────────────────────────

function postCommentViaGh(repo, prNumber, comment) {
  const r = spawnSync('gh', [
    'pr', 'comment', String(prNumber), '--repo', repo, '--body', comment,
  ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15000 });
  return { posted: r.status === 0, error: r.stderr || r.error?.message || null };
}

function resolveCommentPost(repo, prNumber, comment, ghAuthenticated) {
  if (ghAuthenticated) {
    return postCommentViaGh(repo, prNumber, comment);
  }
  return {
    posted: false,
    reason: 'gh not authenticated — comment printed to stdout instead',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(rawArgs) {
  const args = parseArgs(rawArgs);
  const timestamp = new Date().toISOString();

  const mergeCheck = checkMergeRefusal(args);
  if (mergeCheck.refused) {
    return {
      agent: 'PR Reviewer Bot v1',
      label: LABEL,
      status: 'FAIL',
      risk_level: 3,
      timestamp,
      error: `REFUSED: ${mergeCheck.flag} is not supported. This agent is observe-only and will never merge.`,
      warnings: [`${mergeCheck.flag} was passed — PR Reviewer Bot has no merge capability`],
      recommended_next_actions: ['Remove the merge flag. Re-run without it for a review-only report.'],
      safety: { observe_only: true, merge_capable: false },
    };
  }

  if (!args.repo || !args.pr) {
    return {
      agent: 'PR Reviewer Bot v1',
      label: LABEL,
      status: 'FAIL',
      risk_level: 1,
      timestamp,
      error: 'Missing required arguments: --repo <owner/repo> --pr <number>',
      warnings: ['No PR target specified'],
      recommended_next_actions: ['Run: node scripts/pr-reviewer.cjs --repo owner/repo --pr 123'],
      safety: { observe_only: true, merge_capable: false },
    };
  }

  const ghAvailable = isGhAvailable();
  const ghAuthenticated = ghAvailable && isGhAuthenticated();

  let prMeta = null;
  let prFiles = null;
  let prDiff = null;
  let metaSource = 'none';
  let diffSource = 'none';

  if (ghAvailable) {
    prMeta = fetchPrMetaViaGh(args.repo, args.pr);
    if (prMeta) {
      prFiles = fetchPrFilesViaGh(args.repo, args.pr);
      metaSource = 'gh-cli';
    }
  }

  if (!prMeta) {
    prMeta = await fetchPrMetaViaApi(args.repo, args.pr);
    if (prMeta) {
      prFiles = await fetchPrFilesViaApi(args.repo, args.pr);
      metaSource = 'github-api';
    }
  }

  if (prMeta) {
    const localDiff = fetchPrDiffViaGit(prMeta.baseRefName, prMeta.headRefName);
    if (localDiff) {
      prDiff = localDiff;
      diffSource = 'local-git';
    }
    if (!prDiff && ghAvailable) {
      prDiff = fetchPrDiffViaGh(args.repo, args.pr);
      if (prDiff) diffSource = 'gh-cli';
    }
  }

  const files = (prFiles || []).map((f) => {
    const classified = classifyFile(f.path);
    return { path: f.path, ...classified, strict_zone: isStrictZone(f.path) };
  });

  const fileSummary = {
    total: files.length,
    files,
    high_risk_count: files.filter((f) => f.risk === 'high').length,
    medium_risk_count: files.filter((f) => f.risk === 'medium').length,
    low_risk_count: files.filter((f) => f.risk === 'low').length,
    strict_zone_count: files.filter((f) => f.strict_zone).length,
  };

  const redFlags = scanRedFlags(prDiff);
  const validation = runValidation(args.skipValidation);
  const verdict = buildVerdict(files, redFlags, validation);

  const report = {
    agent: 'PR Reviewer Bot v1',
    label: LABEL,
    status: verdict.status,
    risk_level: verdict.risk_level,
    timestamp,
    pr: { repo: args.repo, number: args.pr },
    meta_source: metaSource,
    diff_source: diffSource,
    pr_meta: prMeta,
    file_summary: fileSummary,
    red_flags: redFlags,
    validation,
    verdict,
    warnings: verdict.reasons,
    recommended_next_actions: [verdict.recommendation],
    safety: { observe_only: true, merge_capable: false, commit_capable: false, push_capable: false },
  };

  const markdownComment = buildMarkdownComment(report);
  report.markdown_comment = markdownComment;

  if (args.postComment) {
    const posted = resolveCommentPost(args.repo, args.pr, markdownComment, ghAuthenticated);
    report.comment_posted = posted;
    if (!posted.posted) {
      // Fallback: the markdown comment is already in report.markdown_comment
      report.comment_posted.fallback = 'markdown_comment field contains the comment text';
    }
  }

  return report;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  parseArgs,
  checkMergeRefusal,
  classifyFile,
  classifyContextType,
  hasProductionImpact,
  isStrictZone,
  parseDiffLines,
  scanRedFlags,
  buildVerdict,
  buildMarkdownComment,
  resolveCommentPost,
  isGhAvailable,
  isGhAuthenticated,
  fetchPrDiffViaGit,
};

if (require.main === module) {
  run(process.argv.slice(2))
    .then((report) => {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.exit(report.status === 'FAIL' ? 1 : 0);
    })
    .catch((err) => {
      process.stdout.write(JSON.stringify({
        agent: 'PR Reviewer Bot v1',
        label: LABEL,
        status: 'FAIL',
        risk_level: 3,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        warnings: ['Unexpected error in PR Reviewer Bot'],
        recommended_next_actions: ['Check scripts/pr-reviewer.cjs for bugs'],
        safety: { observe_only: true, merge_capable: false },
      }, null, 2) + '\n');
      process.exit(1);
    });
}
