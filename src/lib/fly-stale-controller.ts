import { statSync } from 'node:fs'
import { join } from 'node:path'

export interface FlyStaleProbe {
  artifactMtimeMs(path: string): number | null
  processStartMs(): number
}

const defaultProbe: FlyStaleProbe = {
  artifactMtimeMs(path) {
    try { return statSync(path).mtimeMs } catch { return null }
  },
  processStartMs() { return Date.now() - process.uptime() * 1000 },
}

/** The standalone entrypoint this process was started from. */
export function flyControllerArtifactPath(cwd: string = process.cwd()): string {
  return join(cwd, 'server.js')
}

/**
 * A controller survives a redeploy that overwrites its artifact: launchd restarts
 * only the job it supervises, so a manually started process keeps polling the same
 * queue. It then serves lazily loaded chunks from the new build while holding
 * modules from the old one, which silently mis-attributes durable queue rows.
 * An artifact newer than the process is proof the process is running replaced code.
 */
export function flyControllerIsStale(probe: FlyStaleProbe = defaultProbe, cwd: string = process.cwd()): boolean {
  const mtimeMs = probe.artifactMtimeMs(flyControllerArtifactPath(cwd))
  if (mtimeMs === null) return false // Not a standalone deployment; nothing to compare against.
  return mtimeMs > probe.processStartMs() + 5_000 // Tolerate clock skew and start-up copying.
}
