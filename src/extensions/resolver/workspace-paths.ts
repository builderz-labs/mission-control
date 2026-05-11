import path from 'node:path'
import { config } from '@/lib/config'

/**
 * Resolve the OpenClaw workspace directory the resolver extension writes its
 * runtime artifacts into (telemetry log, override file, weekly/quarterly audit
 * dirs). Replicates the upstream computation in `src/lib/config.ts:48-51` —
 * env-var first, fall back to `<openclawStateDir>/workspace`. Keeps the lookup
 * inside the extension so `src/lib/config.ts` stays byte-clean against upstream
 * (FORK.md upstream-touch contract).
 *
 * Returns empty string when no workspace can be resolved. Callers already
 * `if (...)` on the result to handle that case.
 */
export function getOpenclawWorkspaceDir(): string {
  return (
    process.env.OPENCLAW_WORKSPACE_DIR ||
    process.env.MISSION_CONTROL_WORKSPACE_DIR ||
    (config.openclawStateDir ? path.join(config.openclawStateDir, 'workspace') : '')
  )
}
