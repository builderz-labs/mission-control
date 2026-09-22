import { describe, expect, it } from 'vitest'
import { flyControllerArtifactPath, flyControllerIsStale, type FlyStaleProbe } from '../fly-stale-controller'

function probe(artifactMtimeMs: number | null, processStartMs: number): FlyStaleProbe {
  return { artifactMtimeMs: () => artifactMtimeMs, processStartMs: () => processStartMs }
}

describe('flyControllerIsStale', () => {
  it('resolves the standalone entrypoint beside the working directory', () => {
    expect(flyControllerArtifactPath('/srv/app')).toBe('/srv/app/server.js')
  })

  it('reports a process whose artifact was rebuilt after it started', () => {
    const start = Date.parse('2026-09-06T14:32:05Z')
    const rebuilt = Date.parse('2026-09-06T15:06:31Z')
    expect(flyControllerIsStale(probe(rebuilt, start))).toBe(true)
  })

  it('accepts a process started from the current artifact', () => {
    const built = Date.parse('2026-09-06T15:06:31Z')
    const start = Date.parse('2026-09-06T15:06:39Z')
    expect(flyControllerIsStale(probe(built, start))).toBe(false)
  })

  it('tolerates an artifact written moments into start-up', () => {
    const start = Date.parse('2026-09-06T15:06:39Z')
    expect(flyControllerIsStale(probe(start + 3_000, start))).toBe(false)
  })

  it('stays silent when no standalone artifact exists', () => {
    expect(flyControllerIsStale(probe(null, Date.now()))).toBe(false)
  })
})
