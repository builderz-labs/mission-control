import { promises as fs, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/command'
import { getOpenCodeExecutable } from '@/lib/opencode-sessions'

/**
 * Resolve a CLI binary to an absolute path by scanning PATH directories.
 * Next.js standalone server's process.env may not always allow Node's
 * default execvp lookup to find tools installed in user-local bins
 * (`~/.local/bin`) — observed empirically as `spawn claude ENOENT` even
 * though `which claude` succeeds in the same container. Resolving the
 * absolute path eliminates the ambiguity. Falls back to bare name.
 */
async function resolveExecutable(name: string): Promise<string> {
  if (name.includes('/')) return name
  const candidates = [
    process.env.CLAUDE_BIN,
    `/home/nextjs/.local/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter((p): p is string => !!p && p.endsWith(`/${name}`))
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean)
  for (const dir of pathDirs) candidates.push(path.join(dir, name))
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return name
}

/**
 * Resolve the absolute project path that owns a Claude session.
 *
 * Claude stores transcripts at `~/.claude/projects/<encoded>/<session>.jsonl`.
 * Decoding the directory name back to a path is unreliable because claude
 * collapses both `/` and `_` to `-` in newer versions, so e.g. both
 * `/foo/bar_baz` and `/foo/bar/baz` round-trip to `-foo-bar-baz`.
 *
 * Authoritative source: every jsonl entry includes a `cwd` field with the
 * real absolute path. We scan for the session file, read its first few
 * entries, and return the cwd verbatim.
 *
 * `claude --resume <id>` only finds the conversation when the process cwd
 * matches that project path; without it the process defaults to /app
 * inside the container, so any host-created session fails with
 * "No conversation found".
 */
async function resolveClaudeSessionCwd(sessionId: string): Promise<string | null> {
  const home = os.homedir()
  const projectsRoot = path.join(home, '.claude', 'projects')
  let entries: string[]
  try {
    entries = await fs.readdir(projectsRoot)
  } catch {
    return null
  }
  for (const encoded of entries) {
    const candidate = path.join(projectsRoot, encoded, `${sessionId}.jsonl`)
    try {
      await fs.access(candidate)
    } catch {
      continue
    }
    // Read up to ~64KB and walk lines until we find a `cwd` field.
    let head: string
    try {
      const handle = await fs.open(candidate, 'r')
      try {
        const buf = Buffer.alloc(64 * 1024)
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        head = buf.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
    for (const line of head.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed) as { cwd?: unknown }
        if (typeof entry.cwd === 'string' && entry.cwd.startsWith('/')) {
          return entry.cwd
        }
      } catch {
        // partial line at the buffer edge or non-JSON line; keep scanning
      }
    }
    return null
  }
  return null
}

type ContinueKind = 'claude-code' | 'codex-cli' | 'opencode'

/**
 * MC_HOST_SESSION_MODE — how MC's `claude --resume` interacts with a session
 * that may already have a live `claude` CLI on the host writing to the same
 * jsonl.
 *
 *   coexist (default) — always spawn; both processes append to the jsonl,
 *     and each picks up the other's writes on its next prompt. Possible
 *     interleaving on simultaneous writes.
 *   block-active     — refuse with 409 if the jsonl was touched in the last
 *     LIVE_WINDOW_MS seconds (heuristic: a live host CLI updates mtime
 *     frequently). Forces MC to act only on idle sessions.
 *   nudge            — spawn like coexist, but additionally `touch` the
 *     jsonl after the response so the host CLI sees a fresh mtime and is
 *     more likely to pick up the new entries on its next operation.
 */
type HostSessionMode = 'coexist' | 'block-active' | 'nudge'
const HOST_SESSION_LIVE_WINDOW_MS = 60 * 1000

function getHostSessionMode(): HostSessionMode {
  const raw = (process.env.MC_HOST_SESSION_MODE || '').trim().toLowerCase()
  if (raw === 'block-active' || raw === 'nudge') return raw
  return 'coexist'
}

function sanitizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Single-quote a string for safe inclusion in `sh -c "..."`. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Best-effort mtime check on a session jsonl in any candidate project dir. */
async function getSessionJsonlMtime(sessionId: string): Promise<number | null> {
  const home = os.homedir()
  const projectsRoot = path.join(home, '.claude', 'projects')
  let entries: string[]
  try {
    entries = await fs.readdir(projectsRoot)
  } catch {
    return null
  }
  for (const encoded of entries) {
    const candidate = path.join(projectsRoot, encoded, `${sessionId}.jsonl`)
    try {
      const stat = await fs.stat(candidate)
      return stat.mtimeMs
    } catch {
      continue
    }
  }
  return null
}

/**
 * POST /api/sessions/continue
 * Body: { kind: 'claude-code'|'codex-cli'|'opencode', id: string, prompt: string }
 *
 * TODO: stream the reply incrementally. Currently this handler waits for
 *   `claude --print` to finish before responding, which can take 10-60s on
 *   long answers. A streaming variant (e.g. POST /api/sessions/continue/stream
 *   returning Server-Sent Events backed by `claude --output-format stream-json`)
 *   would let the chat UI render tokens as they arrive — matching the UX of
 *   the host claude CLI itself.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body?.kind as ContinueKind
    const sessionId = typeof body?.id === 'string' ? body.id.trim() : ''
    const prompt = sanitizePrompt(body?.prompt)

    if (!sessionId || !/^[a-zA-Z0-9._:-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }
    if (kind !== 'claude-code' && kind !== 'codex-cli' && kind !== 'opencode') {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (!prompt || prompt.length > 6000) {
      return NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 })
    }

    let reply = ''

    if (kind === 'claude-code') {
      // Resolve the project cwd for this session — claude --resume only finds
      // the transcript when invoked from the project path encoded in the
      // session file's parent directory. Crucial for shared sessions across
      // host Claude Code and MC container.
      const sessionCwd = await resolveClaudeSessionCwd(sessionId)
      const claudeBin = await resolveExecutable('claude')
      const hostMode = getHostSessionMode()

      // Mode `block-active`: refuse if the host CLI appears to be actively
      // writing the jsonl (recent mtime). Spares the user from interleaved
      // writes between MC and host CLI.
      if (hostMode === 'block-active') {
        const mtimeMs = await getSessionJsonlMtime(sessionId)
        if (mtimeMs !== null && (Date.now() - mtimeMs) < HOST_SESSION_LIVE_WINDOW_MS) {
          return NextResponse.json(
            { error: 'Session has a live host CLI; refusing to --resume (mode=block-active). Wait for it to go idle.' },
            { status: 409 },
          )
        }
      }

      // Use a shell wrapper instead of direct spawn. Next.js standalone server
      // observed `spawn ENOENT` even when the absolute path resolves and is
      // executable from `docker exec node -e`. Routing through `sh -c` works
      // around the issue and keeps argv quoting safe via stdin-fed prompt.
      const runViaShell = async (resume: boolean) => {
        const args = ['--print']
        if (resume) args.push('--resume', sessionId)
        // Read prompt from stdin (`-`) to avoid shell quoting issues with
        // arbitrary user input (newlines, quotes, special chars).
        const cmd = `cd ${shQuote(sessionCwd || '/')} && exec ${shQuote(claudeBin)} ${args.map(shQuote).join(' ')}`
        return runCommand('sh', ['-c', cmd], {
          timeoutMs: 180000,
          input: prompt,
        })
      }

      let result: { stdout: string; stderr: string; code: number | null }
      try {
        result = await runViaShell(true)
      } catch (err: any) {
        const stderrText = String(err?.stderr || err?.message || '')
        const resumeFailed =
          /no conversation found|session.*not found|unknown session/i.test(stderrText)
        if (!resumeFailed) throw err
        logger.warn({ sessionId, sessionCwd, claudeBin }, 'claude --resume failed, retrying as fresh session')
        result = await runViaShell(false)
      }
      reply = (result.stdout || '').trim() || (result.stderr || '').trim()

      // Mode `nudge`: bump jsonl mtime so a tail-following host CLI is more
      // likely to notice fresh entries. Best-effort; no fatal on failure.
      if (hostMode === 'nudge') {
        const mtimeMs = await getSessionJsonlMtime(sessionId)
        if (mtimeMs !== null) {
          const home = os.homedir()
          const projectsRoot = path.join(home, '.claude', 'projects')
          try {
            const entries = await fs.readdir(projectsRoot)
            for (const encoded of entries) {
              const candidate = path.join(projectsRoot, encoded, `${sessionId}.jsonl`)
              try {
                const now = new Date()
                await fs.utimes(candidate, now, now)
                break
              } catch { continue }
            }
          } catch { /* best-effort */ }
        }
      }
    } else if (kind === 'codex-cli') {
      const outputPath = path.join('/tmp', `mc-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      try {
        await runCommand('codex', ['exec', 'resume', sessionId, prompt, '--skip-git-repo-check', '-o', outputPath], {
          timeoutMs: 180000,
        })
      } finally {
        // Read after run attempt either way for best-effort output
      }

      try {
        reply = (await fs.readFile(outputPath, 'utf-8')).trim()
      } catch {
        reply = ''
      }

      try {
        await fs.unlink(outputPath)
      } catch {
        // ignore
      }
    } else {
      const result = await runCommand(getOpenCodeExecutable(), ['run', '--session', sessionId, prompt], {
        timeoutMs: 180000,
      })
      reply = (result.stdout || '').trim() || (result.stderr || '').trim()
    }

    if (!reply) {
      reply = 'Session continued, but no text response was returned.'
    }

    return NextResponse.json({ ok: true, reply })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/continue error')
    return NextResponse.json({ error: error?.message || 'Failed to continue session' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
