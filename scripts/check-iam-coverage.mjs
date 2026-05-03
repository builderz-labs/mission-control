#!/usr/bin/env node
/**
 * IAM-coverage check — fails CI if a fleet handler invokes an AWS API
 * call that isn't granted by the MC task role's `task_ecs_write` policy
 * in ender-stack.
 *
 * Catches the bug class that bit Beat 4c: the DELETE handler called
 * `ecs:ListTaskDefinitions` (a non-delete verb that the original IAM
 * survey missed) and 403'd in dev on the first real attempt. This
 * script enumerates every `*Command` constructor in the fleet
 * handlers, maps each to its IAM action name, and asserts the action
 * is in the granted list below.
 *
 * Contract:
 *   GRANTED_ACTIONS is the source of truth for "what the MC task role
 *   can do" in dev. This list MUST be kept in sync with
 *   ender-stack/terraform/modules/iam/main.tf — specifically the
 *   `task_ecs_write` policy document and the per-instance task-role
 *   grants attached above it.
 *
 *   When ender-stack adds an IAM grant, this list updates in lockstep
 *   (a PR-pair: ender-stack IAM PR + MC list-update PR). When MC adds
 *   a new SDK call, this check fails until the IAM PR + list update
 *   land.
 *
 * Why hardcoded vs Terraform-parsed:
 *   Parsing HCL adds a dependency + complexity for marginal benefit.
 *   The hardcoded list is brittle by design — if ender-stack and MC
 *   drift, this check fails at PR-time, not in dev. That's the
 *   intended contract.
 *
 * Usage:
 *   node scripts/check-iam-coverage.mjs
 *   pnpm iam:coverage
 *
 * Exit codes:
 *   0 — every command in fleet handlers has a corresponding granted action
 *   1 — one or more commands are uncovered (CI fail)
 */

import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// GRANTED_ACTIONS — keep in sync with ender-stack/terraform/modules/iam/main.tf
// ---------------------------------------------------------------------------
//
// Last verified against ender-stack main: 2026-05-02 (post-PR #266).
//
// Categorized by the policy/role that grants the action. The MC task
// role inherits all of these via attachments in
// `task_ecs_write`/`task_ecs_read`/related policies.
const GRANTED_ACTIONS = new Set([
  // task_ecs_read (read-only enumeration)
  'ecs:ListServices',
  'ecs:DescribeServices',
  'ecs:DescribeClusters',

  // task_ecs_write — service lifecycle
  'ecs:CreateService',
  'ecs:UpdateService',
  'ecs:DeleteService',
  'ecs:RegisterTaskDefinition',
  'ecs:DeregisterTaskDefinition',
  'ecs:DescribeTaskDefinition',
  'ecs:ListTaskDefinitions',
  'ecs:TagResource',
  'ecs:UntagResource',

  // task_ecs_write — IAM passrole for ECS task launch.
  //
  // NOTE: this entry is documentation-only. `iam:PassRole` is an
  // implicit policy permission ECS uses when assuming task roles at
  // launch — it has NO corresponding `*Command` constructor in the
  // AWS SDK. The scanner can never flag it as missing (no import
  // would ever generate `iam:PassRole`), so this list entry exists
  // for human readers consulting the canonical action list, not for
  // the script's enforcement loop.
  'iam:PassRole',

  // task_ecs_write — ELBv2 listener/rule/TG management on shared agents ALB
  'elasticloadbalancing:DescribeLoadBalancers',
  'elasticloadbalancing:DescribeTargetGroups',
  'elasticloadbalancing:DescribeListeners',
  'elasticloadbalancing:DescribeRules',
  'elasticloadbalancing:CreateRule',
  'elasticloadbalancing:DeleteRule',
  'elasticloadbalancing:CreateTargetGroup',
  'elasticloadbalancing:DeleteTargetGroup',
  'elasticloadbalancing:RegisterTargets',
  'elasticloadbalancing:DeregisterTargets',
  'elasticloadbalancing:AddTags',

  // task_ecs_write — CloudWatch log lifecycle for per-agent groups
  'logs:CreateLogGroup',
  'logs:DeleteLogGroup',
  'logs:PutRetentionPolicy',
  'logs:DescribeLogGroups',

  // task_ecs_write — SecretsManager write-side for per-agent Slack
  // credentials. Phase 2.4 Beat 5a (ender-stack PR #268) provisioned
  // these grants; Beat 5b.2 (mission-control PR for slack-credentials
  // handler) consumes them. Scope is companion-openclaw-*-slack-*
  // ARNs only — the handler can't write anything outside that.
  // DeleteSecret intentionally omitted (cleanup-on-agent-delete is
  // a separate workflow tracked in ender-stack#270).
  //
  // `secretsmanager:DescribeSecret` is granted but not yet exercised
  // by Beat 5b.2's putOrCreateSecret (which uses a Put-then-Create-
  // on-NotFound pattern, no Describe call). Forward-looking — Beat
  // 5b.3 (channels endpoint) may use it to surface secret-existence
  // state to the operator without reading the value.
  'secretsmanager:CreateSecret',
  'secretsmanager:PutSecretValue',
  'secretsmanager:DescribeSecret',
  'secretsmanager:TagResource',
])

// AWS SDK package → IAM service prefix mapping. PascalCase Command
// names get prefixed with this.
//
// Note on `secrets-manager` vs `secretsmanager`: the SDK package is
// `@aws-sdk/client-secrets-manager` (hyphenated), but the IAM action
// prefix is `secretsmanager:` (no hyphen). Both forms appear here.
const SDK_TO_IAM_PREFIX = {
  '@aws-sdk/client-ecs': 'ecs',
  '@aws-sdk/client-elastic-load-balancing-v2': 'elasticloadbalancing',
  '@aws-sdk/client-cloudwatch-logs': 'logs',
  '@aws-sdk/client-iam': 'iam',
  '@aws-sdk/client-ec2': 'ec2',
  '@aws-sdk/client-secrets-manager': 'secretsmanager',
  '@aws-sdk/client-ssm': 'ssm',
}

// ---------------------------------------------------------------------------
// Scan handler files
// ---------------------------------------------------------------------------

function findHandlerFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip __tests__ — test files mock the SDK so their `Command`
      // references aren't real runtime calls.
      if (entry.name === '__tests__') continue
      findHandlerFiles(full, out)
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      // Skip *.test.ts / *.spec.ts files placed directly in the
      // handler directory (round-1 audit on PR #46 — Greptile
      // caught that __tests__ skip alone misses these). Test files
      // mock the SDK; their `Command` references aren't runtime.
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue
      out.push(full)
    }
  }
  return out
}

/**
 * Parse an SDK import block to map Command names to their IAM service
 * prefix. Handles both single-line and multi-line forms.
 *
 * Example matches:
 *   import { Foo, Bar } from '@aws-sdk/client-ecs'
 *   import {
 *     RegisterTaskDefinitionCommand,
 *     CreateServiceCommand,
 *     type Service,
 *   } from '@aws-sdk/client-ecs'
 */
/**
 * Detect namespace imports of AWS SDK packages
 *   (`import * as ECS from '@aws-sdk/client-ecs'`).
 *
 * Returns the list of (alias, package) tuples found. Empty when the
 * file uses only named imports (the supported form).
 *
 * Why this exists: the named-import scanner in `extractCommandsFromFile`
 * is blind to namespace imports — `await client.send(new ECS.FooCommand(...))`
 * generates zero `*Command` tokens in the named-import position, so an
 * IAM gap could ship undetected. Round-2 audit on PR #46 flagged this
 * class. The fix here is explicit: refuse namespace imports of AWS
 * SDK packages with a loud error directing the developer to convert
 * to named imports. Catching the pattern at PR-time is strictly
 * better than silently growing a blind spot.
 */
function findNamespaceImportsOfAwsSdk(source) {
  const found = []
  const nsImportRe =
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"](@aws-sdk\/[^'"]+)['"]/g
  let match
  while ((match = nsImportRe.exec(source)) !== null) {
    found.push({ alias: match[1], pkg: match[2] })
  }
  return found
}

/**
 * Strip line + block comments from the source before regex parsing.
 * Without this, commented-out imports like `// import { Foo } from
 * '@aws-sdk/client-ecs'` would be matched and checked against
 * GRANTED_ACTIONS — failing CI on code that isn't runtime. Round-3
 * audit on PR #46.
 *
 * Implementation is naïve (string-based, no template-literal
 * awareness) but adequate for an import-line scanner: imports must
 * be at top-level statement positions, not inside templates or
 * string-typed values. False positives would have to be deliberately
 * pathological.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments (avoid http:// etc.)
}

function extractCommandsFromFile(source) {
  const commands = new Map() // CommandName → iamPrefix
  const stripped = stripComments(source)

  // Unknown @aws-sdk packages — warn collector returned alongside
  // commands so the caller can elevate to a hard failure. Round-3
  // audit on PR #46 caught the silent-skip class for unusual import
  // paths (subpath imports, internal SDK paths).
  const unknownAwsSdkPaths = []

  // Multi-line import regex: capture the imports list and the package.
  const importRe =
    /import\s*\{\s*([\s\S]*?)\s*\}\s*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = importRe.exec(stripped)) !== null) {
    const importsBody = match[1]
    const pkg = match[2]
    const iamPrefix = SDK_TO_IAM_PREFIX[pkg]
    if (!iamPrefix) {
      // Loud-fail on unknown @aws-sdk paths so a subpath import like
      // `@aws-sdk/client-ecs/dist/cjs/commands/FooCommand` doesn't
      // silently bypass the IAM check. Non-AWS packages are
      // genuinely irrelevant; only the @aws-sdk namespace is gated.
      if (pkg.startsWith('@aws-sdk/')) {
        unknownAwsSdkPaths.push(pkg)
      }
      continue
    }
    // Split by comma; each fragment may have `type Foo` or just `Foo`
    // or trailing comments. Type-only fragments (`type FooCommand`)
    // are SKIPPED entirely — they're TS type imports that elide at
    // compile time, not runtime SDK calls. Counting them produced
    // false positives flagged by round-1 audit on PR #46 (Greptile
    // P2). Same applies to `import type { ... }` blocks, but those
    // are excluded at the import-regex level (the regex requires
    // whitespace+`{` immediately after `import`, not `import type`).
    for (const raw of importsBody.split(',')) {
      const fragment = raw.trim()
      if (!fragment) continue
      if (/^type\s+/.test(fragment)) continue
      // Drop trailing single-line comments and renames like `as X`.
      const name = fragment.split(/\s|\/\//)[0]
      if (/Command$/.test(name)) {
        commands.set(name, iamPrefix)
      }
    }
  }
  return { commands, unknownAwsSdkPaths }
}

/** PascalCase Command name → IAM action. Drops the trailing `Command`. */
function commandToAction(commandName, iamPrefix) {
  const verb = commandName.replace(/Command$/, '')
  return `${iamPrefix}:${verb}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// HANDLER_DIR is intentionally narrow — only the Next.js route handlers
// under src/extensions/fleet/api/ are scanned. SDK calls outside this
// directory (utility helpers in lib/, template renderers, etc.) are
// NOT scanned. Today, no fleet code outside api/ makes runtime AWS
// calls, but if that changes (e.g. a shared `lib/aws-clients.ts` that
// wraps SDK calls), broaden HANDLER_DIR or add the lib directory as a
// second walk root. Round-1 audit on PR #46 flagged the implicit
// scope.
const HANDLER_DIR = 'src/extensions/fleet/api'

function main() {
  const root = process.cwd()
  const handlerDir = path.join(root, HANDLER_DIR)
  const files = findHandlerFiles(handlerDir)

  // Zero-file guard — if the handler directory is renamed, the
  // process is run from the wrong CWD, or a rebase deletes api/, the
  // pre-fix script would print "0 files scanned" and exit 0 (silent
  // CI green on a real regression). Round-1 audit on PR #46 flagged
  // it; this exits 1 explicitly so the failure mode is loud.
  if (files.length === 0) {
    console.error(`❌ IAM coverage check found ZERO handler files under ${HANDLER_DIR}`)
    console.error('   This is almost certainly a misconfiguration:')
    console.error(`   - Wrong CWD? (currently: ${root})`)
    console.error(`   - Directory renamed or deleted?`)
    console.error('   Refusing to exit 0 on an empty scan.')
    process.exit(1)
  }

  const violations = []
  const namespaceImports = []
  const unknownPaths = []
  const allActions = new Set()

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    // Strip comments once and feed both the namespace-import scan and
    // the named-import scan from the same input. Without this, a
    // commented-out `// import * as ECS from '@aws-sdk/client-ecs'`
    // would fail CI on the namespace-import guard while
    // `extractCommandsFromFile` (which strips internally) would
    // correctly ignore it. Round-4 audit on PR #46 caught the
    // asymmetry.
    const stripped = stripComments(source)
    const nsImports = findNamespaceImportsOfAwsSdk(stripped)
    for (const ns of nsImports) {
      namespaceImports.push({ file: path.relative(root, file), ...ns })
    }
    const { commands, unknownAwsSdkPaths } = extractCommandsFromFile(source)
    for (const pkg of unknownAwsSdkPaths) {
      unknownPaths.push({ file: path.relative(root, file), pkg })
    }
    for (const [name, prefix] of commands) {
      const action = commandToAction(name, prefix)
      allActions.add(action)
      if (!GRANTED_ACTIONS.has(action)) {
        violations.push({ file: path.relative(root, file), action, command: name })
      }
    }
  }

  // Reject namespace imports of AWS SDK packages — they hide commands
  // from the named-import scanner and would let an ungranted action
  // ship silently. Round-2 audit on PR #46.
  if (namespaceImports.length > 0) {
    console.error(
      `❌ Namespace imports of AWS SDK packages found (${namespaceImports.length}):`,
    )
    for (const ns of namespaceImports) {
      console.error(`   ${ns.file}: import * as ${ns.alias} from '${ns.pkg}'`)
    }
    console.error()
    console.error(
      'Fix: convert to named imports so the IAM coverage scanner can see\n' +
        'the Command constructors. Example:\n' +
        "  - import * as ECS from '@aws-sdk/client-ecs'\n" +
        "  + import { ListTaskDefinitionsCommand } from '@aws-sdk/client-ecs'\n",
    )
    process.exit(1)
  }

  // Reject unknown @aws-sdk subpaths. Subpath imports like
  // `@aws-sdk/client-ecs/dist/cjs/commands/FooCommand` would map to
  // no entry in SDK_TO_IAM_PREFIX, so the command would silently
  // skip the IAM check. Round-3 audit on PR #46.
  if (unknownPaths.length > 0) {
    console.error(
      `❌ Unknown @aws-sdk import paths found (${unknownPaths.length}):`,
    )
    for (const u of unknownPaths) {
      console.error(`   ${u.file}: from '${u.pkg}'`)
    }
    console.error()
    console.error(
      'Fix: either (a) convert to a top-level @aws-sdk/client-* import\n' +
        '  whose prefix is in SDK_TO_IAM_PREFIX (e.g. @aws-sdk/client-ecs),\n' +
        'or (b) extend SDK_TO_IAM_PREFIX in this script with the new\n' +
        '  package and its IAM service prefix (e.g. @aws-sdk/client-foo:\n' +
        "  'foo'). Subpath imports (.../dist/...) silently bypass coverage\n" +
        '  and are refused as a class.',
    )
    process.exit(1)
  }

  // `iam:PassRole` is in GRANTED_ACTIONS for documentation only — no
  // SDK Command resolves to it, so it can't appear in the
  // enforceable-action set. Subtract it for the count display so the
  // summary line reflects actually-enforceable grants.
  const enforceableGrantedCount = Array.from(GRANTED_ACTIONS).filter(
    (a) => a !== 'iam:PassRole',
  ).length

  console.log('IAM coverage check')
  console.log(`- handler files scanned: ${files.length}`)
  console.log(`- distinct AWS actions used: ${allActions.size}`)
  console.log(
    `- granted actions in policy: ${enforceableGrantedCount} (+1 doc-only: iam:PassRole)`,
  )
  console.log()

  if (violations.length === 0) {
    console.log('✅ IAM coverage OK — every fleet-handler AWS call is granted')
    process.exit(0)
  }

  console.error(`❌ IAM coverage gaps (${violations.length}):`)
  for (const v of violations) {
    console.error(`   ${v.file}: ${v.command} → action "${v.action}" not in GRANTED_ACTIONS`)
  }
  console.error()
  console.error(
    'Fix: add the missing action(s) to the MC task role policy in\n' +
      '  ender-stack/terraform/modules/iam/main.tf (task_ecs_write or related)\n' +
      'AND update GRANTED_ACTIONS in this script to match. Both must move\n' +
      'together — the script + the IAM policy are the dual contract.',
  )
  process.exit(1)
}

main()
