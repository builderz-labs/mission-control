/**
 * Fork-contract: upstream byte-clean assertion.
 *
 * Catches the regression class where a PR (or a rebase merge-conflict
 * resolution) accidentally modifies an upstream file outside the
 * approved touch points listed in FORK.md (plus the legacy-debt
 * grandfathered set in approved-upstream-paths.ts). Without this gate,
 * the only line of defense was reviewer attention, which scaled poorly
 * as the extension footprint grew (PRs #61–#64).
 *
 * Behaviour:
 *   - Lists files MODIFIED relative to `upstream/main` under `src/`
 *   - --diff-filter=M is intentional scope: deletions (D) and renames
 *     (R, emitted as D+A) of upstream files are NOT flagged. Rationale:
 *     fork-side deletion of an unused upstream file is a legitimate
 *     cleanup (mc-fork#331 burndown class), and the typecheck step
 *     catches any deletion that breaks an upstream import chain. If a
 *     PR deletes an ALLOWLISTED file, the second assertion below
 *     ("every approved path must exist") fires loudly.
 *   - Additions (A) under src/extensions/ are the entire fork-extension
 *     surface — they're "added" relative to upstream, not "modified".
 *   - Compares the modified set against APPROVED_UPSTREAM_TOUCH_PATHS
 *   - Fails if any file outside the allowlist is modified
 *
 * Local dev:
 *   - If `upstream` remote isn't configured, the test self-skips. Add
 *     it once with: `git remote add upstream https://github.com/builderz-labs/mission-control.git`
 *   - Set SKIP_FORK_CONTRACT=1 to bypass for emergency rebase-in-progress
 *     work where the diff is intentionally messy mid-flight.
 *
 * CI:
 *   - quality-gate.yml fetches `upstream/main` before `pnpm test` runs.
 *
 * Sibling to manifest-registration.test.ts and client-boot.test.tsx
 * (PR #65). Together they form the Phase-2.5 fork-regression layer.
 */
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { APPROVED_UPSTREAM_TOUCH_PATHS } from './fixtures/approved-upstream-paths'

const UPSTREAM_REF = 'upstream/main'

function hasUpstreamRef(): boolean {
  try {
    execSync(`git rev-parse --verify ${UPSTREAM_REF}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function modifiedSrcFilesVsUpstream(): string[] {
  // Diff against the merge-base, not upstream/main directly:
  //   - Merge-base captures "everything the fork has done since branching"
  //     (avoids spurious "deletions" when upstream/main has moved ahead).
  //   - Diffing without a trailing ref (no `...HEAD`) compares against the
  //     working tree — picks up uncommitted/unstaged edits too. CI sees
  //     no difference; local devs get caught pre-commit instead of seeing
  //     a false-green from `git diff <ref>...HEAD` (committed only).
  //
  // Scope is intentionally limited to src/. Root-level upstream files
  // (package.json, next.config.js, .nvmrc, etc.) aren't watched — those
  // need a separate gate if drift becomes a problem.
  let mergeBase: string
  try {
    mergeBase = execSync(`git merge-base ${UPSTREAM_REF} HEAD`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  } catch (err) {
    throw new Error(
      `git merge-base ${UPSTREAM_REF} HEAD failed. Likely causes: ` +
        `(1) shallow CI checkout — set fetch-depth: 0 on actions/checkout, ` +
        `(2) upstream fetched too shallow — drop --depth from the upstream fetch step. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const out = execSync(
    `git diff --name-only --diff-filter=M ${mergeBase} -- src/`,
    { encoding: 'utf-8' },
  )
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

describe('fork-contract — upstream byte-clean', () => {
  const skipReason = process.env.SKIP_FORK_CONTRACT === '1'
    ? 'SKIP_FORK_CONTRACT=1'
    : !hasUpstreamRef()
    ? `${UPSTREAM_REF} not fetched (run: git remote add upstream https://github.com/builderz-labs/mission-control.git && git fetch upstream main)`
    : null

  it.skipIf(skipReason)(
    'only allowlisted paths are modified relative to upstream/main',
    () => {
      const modified = modifiedSrcFilesVsUpstream()
      const approved = new Set<string>(APPROVED_UPSTREAM_TOUCH_PATHS)
      const violations = modified.filter((f) => !approved.has(f))
      expect(
        violations,
        `Files modified outside the approved upstream-touch allowlist ` +
          `(see src/extensions/__tests__/fixtures/approved-upstream-paths.ts):\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          `\n\nIf you need to touch additional upstream files, update FORK.md AND ` +
          `src/extensions/__tests__/fixtures/approved-upstream-paths.ts in the same PR.`,
      ).toEqual([])
    },
  )

  it.skipIf(skipReason)(
    'every approved path actually exists in the working tree (allowlist guard)',
    () => {
      // Defensive: if FORK.md ever drops a touch point but this fixture
      // isn't updated, the test would silently allow modifications under
      // a path that no longer needs special permission. Confirm each
      // entry still resolves to a real file so stale entries get caught.
      const present = execSync('git ls-files src/', { encoding: 'utf-8' })
        .split('\n')
        .map((s) => s.trim())
      const missing = APPROVED_UPSTREAM_TOUCH_PATHS.filter((p) => !present.includes(p))
      expect(
        missing,
        `Approved-path fixture lists files that don't exist in the working tree:\n` +
          missing.map((m) => `  - ${m}`).join('\n'),
      ).toEqual([])
    },
  )
})
