'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api-client'

/**
 * Link to a workspace file in the memory browser that probes whether the
 * file actually exists. Paths mentioned in agent comments are often planned
 * files or repo-relative shorthand, so a plain link would land on a "file
 * not found" state — a false positive. Missing files get a dashed, muted
 * style and a tooltip instead of looking like a working link.
 */

type ExistsState = 'unknown' | 'exists' | 'missing'

// Module-level cache so repeated mentions of the same path probe once.
const existsCache = new Map<string, Promise<boolean>>()

function probeExists(path: string): Promise<boolean> {
  let pending = existsCache.get(path)
  if (!pending) {
    pending = apiFetch<{ exists: boolean }>(
      `/api/memory?action=exists&path=${encodeURIComponent(path)}`,
    )
      .then((data) => Boolean(data?.exists))
      .catch(() => {
        // Probe failure (network, auth, not configured): don't mark as missing.
        existsCache.delete(path)
        return true
      })
    existsCache.set(path, pending)
  }
  return pending
}

interface FilePathLinkProps {
  /** Workspace-relative path, e.g. `docs/plans/x.md`. */
  path: string
  /** Deep link to the memory browser, e.g. `/memory?path=...`. */
  href: string
  children?: ReactNode
}

export function FilePathLink({ path, href, children }: FilePathLinkProps) {
  const [state, setState] = useState<ExistsState>('unknown')

  useEffect(() => {
    let cancelled = false
    probeExists(path).then((exists) => {
      if (!cancelled) setState(exists ? 'exists' : 'missing')
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const missing = state === 'missing'

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-file-missing={missing ? 'true' : undefined}
      title={missing ? `${path} — file not found in the workspace (planned path?)` : undefined}
      className={
        missing
          ? 'text-foreground/50 underline decoration-dashed decoration-foreground/40 hover:text-foreground/70'
          : 'text-blue-400 hover:text-blue-300 underline'
      }
    >
      {children ?? path}
    </a>
  )
}
