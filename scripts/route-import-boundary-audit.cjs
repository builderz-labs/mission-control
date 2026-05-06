#!/usr/bin/env node
/**
 * route-import-boundary-audit.cjs
 * Observe-only audit: detects GET routes that statically import heavy modules.
 * Exits 0 for PASS/WARN. Exits 1 only on script/runtime failure.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AGENT = 'Route Import Boundary Audit v1';
const LABEL = 'OBSERVE ONLY';

const RISKY_MODULES = [
  '@/lib/super-admin',
  '@/lib/command',
  '@/lib/provisioner-client',
  'child_process',
  'node:child_process',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function collectRouteFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRouteFiles(fullPath));
    } else if (entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Detect static (runtime) risky imports in a file's content.
 * Excludes:
 *   - dynamic imports: import(...)
 *   - type-only imports: import type { ... }
 */
function detectStaticRiskyImports(content) {
  const found = [];
  const lines = content.split('\n');
  for (const line of lines) {
    // Must start with 'import' (not 'import(' and not 'import type')
    if (!/^\s*import\s+(?!type[\s{*])(?!\()/.test(line)) continue;
    for (const mod of RISKY_MODULES) {
      const escaped = mod.replace(/[/\\$^*+?.()|[\]{}]/g, '\\$&');
      const pattern = new RegExp(`from\\s+['"]${escaped}['"]`);
      if (pattern.test(line) && !found.includes(mod)) {
        found.push(mod);
      }
    }
  }
  return found;
}

/**
 * Detect exported HTTP method handlers (GET, POST, etc.).
 */
function detectExportedMethods(content) {
  const found = [];
  for (const method of HTTP_METHODS) {
    if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`).test(content)) {
      found.push(method);
    }
  }
  return found;
}

/**
 * Analyze a single route file.
 * Returns a route analysis object with risk_level 0, 1, or 2.
 */
function analyzeRouteFile(content, filePath) {
  const riskyImports = detectStaticRiskyImports(content);
  const methods = detectExportedMethods(content);
  const hasGet = methods.includes('GET');

  let riskLevel = 0;
  let recommendation = 'No risky static imports detected.';

  if (riskyImports.length > 0) {
    if (hasGet) {
      riskLevel = 2;
      recommendation =
        `GET route statically imports heavy module(s): ${riskyImports.join(', ')}. ` +
        'Extract read-only helpers into a lightweight query module.';
    } else {
      riskLevel = 1;
      recommendation =
        `Non-GET route has risky static import(s): ${riskyImports.join(', ')}. ` +
        'Consider using dynamic import if the module is only needed at write time.';
    }
  }

  return {
    file: filePath,
    methods,
    risky_static_imports: riskyImports,
    risk_level: riskLevel,
    recommendation,
  };
}

function runAudit(rootDir) {
  const apiDir = path.join(rootDir, 'src', 'app', 'api');
  const absolutePaths = collectRouteFiles(apiDir);

  const routes = absolutePaths.map((absPath) => {
    const content = fs.readFileSync(absPath, 'utf8');
    const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');
    return analyzeRouteFile(content, relPath);
  });

  routes.sort((a, b) => b.risk_level - a.risk_level || a.file.localeCompare(b.file));

  const riskyRoutes = routes.filter((r) => r.risky_static_imports.length > 0);
  const getRoutesWithRiskyImports = routes.filter((r) => r.risk_level === 2);

  const recommendations = [];
  if (getRoutesWithRiskyImports.length > 0) {
    recommendations.push(
      `${getRoutesWithRiskyImports.length} GET route(s) statically import heavy modules. ` +
      'Extract read-only helpers into lightweight query modules.'
    );
  }
  const nonGetRisky = riskyRoutes.length - getRoutesWithRiskyImports.length;
  if (nonGetRisky > 0) {
    recommendations.push(
      `${nonGetRisky} non-GET route(s) have risky static imports. ` +
      'Consider dynamic imports for write-only modules.'
    );
  }
  if (recommendations.length === 0) {
    recommendations.push('All scanned route import boundaries are clean.');
  }

  const overallRisk = getRoutesWithRiskyImports.length > 0 ? 2 : (riskyRoutes.length > 0 ? 1 : 0);
  const status = overallRisk === 2 ? 'WARN' : (overallRisk === 1 ? 'WARN' : 'PASS');

  return {
    agent: AGENT,
    label: LABEL,
    status,
    risk_level: overallRisk,
    summary: {
      routes_scanned: routes.length,
      routes_with_risky_imports: riskyRoutes.length,
      get_routes_with_risky_imports: getRoutesWithRiskyImports.length,
    },
    routes: riskyRoutes,
    recommendations,
  };
}

module.exports = { analyzeRouteFile, detectStaticRiskyImports, detectExportedMethods, runAudit };

if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..');
  try {
    const result = runAudit(ROOT);
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
