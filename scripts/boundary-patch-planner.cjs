#!/usr/bin/env node
/**
 * boundary-patch-planner.cjs
 * Observe-only planner: reads route-import-boundary-audit findings and produces
 * a conservative, ranked list of safe next import-boundary patches.
 * Exits 0 for PASS/WARN. Exits 1 only on script/runtime failure.
 */

'use strict';

const path = require('node:path');

const AGENT = 'Boundary Patch Planner v1';
const LABEL = 'OBSERVE ONLY';

// Route paths that suggest execution, destructive, or file-serving behavior — defer these.
const AVOID_PATH_PATTERNS = [
  'backup',
  'diagnostic',
  'exec-approval',
  'gateways/control',
  'local/terminal',
  'pipelines/run',
  'pty',
  'releases/update',
  'security-scan',
  'sessions/continue',
  'spawn',
  'system-monitor',
];

/**
 * Derive a proposed lightweight query helper path from a route file path.
 * e.g. src/app/api/memory/context/route.ts  -> src/lib/memory-context-queries.ts
 *      src/app/api/super/tenants/route.ts   -> src/lib/tenants-queries.ts  (already done)
 */
function proposedHelperName(routeFile) {
  const parts = routeFile
    .replace('src/app/api/', '')
    .replace('/route.ts', '')
    .split('/')
    .filter((p) => !p.startsWith('['))
    .slice(-2);
  return `src/lib/${parts.join('-')}-queries.ts`;
}

/**
 * Score a risk_level 2 route candidate.
 * Returns { score, avoidNotes } or null if not a risk_level 2 candidate.
 *
 * Scoring rationale:
 *   +30  base: GET route with risky static import
 *   +20  single risky import  (narrow patch scope)
 *   +15  import is @/lib/super-admin  (established extraction pattern)
 *   +10  GET-only route  (no write-path risk)
 *   -5   per write method beyond first (mixed-use routes need more care)
 *   -8   fs import (may be file-serving, not DB reads — verify first)
 *   -10  3+ risky imports (wider patch scope)
 *   -15  @/lib/command import (execution module, not a DB-read extraction candidate)
 *   -20  path matches an avoid pattern (execution/destructive semantics)
 *   -25  child_process import (OS execution, never a simple extraction candidate)
 */
function scoreRouteCandidate(route) {
  if (route.risk_level < 2) return null;

  let score = 30;
  const avoidNotes = [];
  const imports = route.risky_static_imports;
  const methods = route.methods;
  const fileLower = route.file.toLowerCase();

  // Single import = narrowest possible patch
  if (imports.length === 1) {
    score += 20;
  } else if (imports.length >= 3) {
    score -= 10;
    avoidNotes.push(`${imports.length} risky imports — patch scope is wider than ideal`);
  }

  // super-admin: established two-step pattern (extract + re-export)
  if (imports.includes('@/lib/super-admin')) {
    score += 15;
  }

  // GET-only: no write path affected at all
  const writeMethods = methods.filter((m) => m !== 'GET');
  if (writeMethods.length === 0) {
    score += 10;
  } else {
    score -= writeMethods.length * 5;
    if (writeMethods.length >= 2) {
      avoidNotes.push(`mixed-use route (${methods.join('+')}) — splitting GET requires care`);
    }
  }

  // Execution-module penalties
  for (const imp of imports) {
    if (imp === 'child_process' || imp === 'node:child_process') {
      score -= 25;
      avoidNotes.push(`imports ${imp} — OS execution, not a DB-read extraction candidate`);
    } else if (imp === '@/lib/command') {
      score -= 15;
      avoidNotes.push('imports @/lib/command — execution module; verify GET is read-only before patching');
    }
  }

  // fs penalty: lighter (may be config/file reads, worth verifying)
  const fsImports = imports.filter(
    (m) => m === 'fs' || m === 'node:fs' || m.includes('fs/promises')
  );
  if (fsImports.length > 0 && !imports.includes('@/lib/super-admin')) {
    score -= 8;
    avoidNotes.push(
      `imports ${fsImports.join(', ')} — verify whether GET is config-reading or file-serving before patching`
    );
  }

  // Avoid-path penalty
  for (const pattern of AVOID_PATH_PATTERNS) {
    if (fileLower.includes(pattern)) {
      score -= 20;
      avoidNotes.push(`route path matches "${pattern}" — likely execution/destructive behavior, defer`);
      break;
    }
  }

  return { score, avoidNotes };
}

function buildRankReason(route, avoidNotes) {
  const parts = [];
  const imports = route.risky_static_imports;
  const isGetOnly = route.methods.length === 1 && route.methods[0] === 'GET';

  if (imports.includes('@/lib/super-admin')) parts.push('established super-admin extraction pattern');
  if (imports.length === 1) parts.push('single risky import (narrow patch scope)');
  if (isGetOnly) parts.push('GET-only route (no write-path risk)');
  if (avoidNotes.length > 0) parts.push(`${avoidNotes.length} concern(s) noted`);
  if (parts.length === 0) parts.push('risk_level 2 GET route with risky static import');

  return parts.join('; ');
}

function buildPatchShape(route) {
  const imports = route.risky_static_imports;
  const helper = proposedHelperName(route.file);

  if (imports.includes('@/lib/super-admin')) {
    return (
      `Extract read helpers from @/lib/super-admin into ${helper}. ` +
      `Add re-export from super-admin for backward compatibility. ` +
      `Update GET to import from lightweight ${helper}.`
    );
  }
  const hasCommand = imports.includes('@/lib/command');
  if (hasCommand) {
    return (
      `Audit whether GET handler needs full @/lib/command module. ` +
      `If GET only reads data, extract into ${helper}. ` +
      `If command is shared with write methods, defer or use dynamic import in write path.`
    );
  }
  const fsImports = imports.filter(
    (m) => m === 'fs' || m === 'node:fs' || m.includes('fs/promises')
  );
  if (fsImports.length > 0) {
    return (
      `Extract file-read logic used by GET into ${helper}. ` +
      `Keep fs import only in ${helper}. ` +
      `If write methods also use fs, consider dynamic import in those paths.`
    );
  }
  return (
    `Extract read-only logic from ${imports.join(', ')} into ${helper}. ` +
    `Update GET import to use lightweight module.`
  );
}

/**
 * Core planning function. Takes an audit result object (from runAudit) and
 * returns a ranked patch plan.
 */
function planPatches(auditResult) {
  const candidates = (auditResult.routes || []).filter((r) => r.risk_level === 2);

  const scored = candidates
    .map((route) => {
      const result = scoreRouteCandidate(route);
      if (!result) return null;
      const { score, avoidNotes } = result;
      return {
        route: route.file,
        methods: route.methods,
        risky_static_imports: route.risky_static_imports,
        score,
        rank_reason: buildRankReason(route, avoidNotes),
        recommended_patch_shape: buildPatchShape(route),
        avoid_notes: avoidNotes,
      };
    })
    .filter(Boolean);

  scored.sort((a, b) => b.score - a.score || a.route.localeCompare(b.route));

  const top = scored[0] || null;
  let topRec = null;

  if (top) {
    const helper = proposedHelperName(top.route);
    const libImports = top.risky_static_imports
      .filter((m) => m.startsWith('@/lib/'))
      .map((m) => m.replace('@/', 'src/') + '.ts');

    topRec = {
      route: top.route,
      reason: top.rank_reason,
      proposed_helper: helper,
      expected_files_to_change: [helper, top.route, ...libImports],
      constraints: [
        'Preserve GET response shape exactly',
        'Do not modify POST/PUT/DELETE behavior',
        'Add re-export from source module if other consumers import from it',
        'Narrow diff only — do not refactor unrelated code',
      ],
      validation: [
        'pnpm typecheck',
        'pnpm lint',
        'pnpm test --run',
        'pnpm build',
        'node scripts/route-import-boundary-audit.cjs  # should show one fewer risk_level 2 route',
        'node scripts/mission-control-preflight.cjs',
        'node scripts/mc-coordinator.cjs',
      ],
    };
  }

  const status = scored.length > 0 ? 'WARN' : 'PASS';
  const riskLevel = scored.length > 0 ? 1 : 0;

  return {
    agent: AGENT,
    label: LABEL,
    status,
    risk_level: riskLevel,
    summary: {
      audit_status: auditResult.status || 'UNKNOWN',
      audit_risk_level: auditResult.risk_level ?? -1,
      candidates_considered: candidates.length,
      recommended_candidates: scored.length,
    },
    top_recommendation: topRec,
    ranked_candidates: scored,
    recommendations:
      scored.length > 0
        ? [
            `Top candidate: ${top.route} (score ${top.score}) — ${top.rank_reason}`,
            `${scored.length} risk_level 2 GET routes ranked. Address top candidate first, then re-run audit.`,
          ]
        : ['No risk_level 2 GET routes found. Import boundaries are clean.'],
  };
}

function runPlanner(rootDir) {
  const { runAudit } = require(path.join(__dirname, 'route-import-boundary-audit.cjs'));
  const auditResult = runAudit(rootDir);
  return planPatches(auditResult);
}

module.exports = { scoreRouteCandidate, planPatches, proposedHelperName };

if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..');
  try {
    const result = runPlanner(ROOT);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        agent: AGENT,
        label: LABEL,
        status: 'FAIL',
        risk_level: 2,
        error: err && err.message ? err.message : String(err),
      }, null, 2) + '\n'
    );
    process.exit(1);
  }
}
