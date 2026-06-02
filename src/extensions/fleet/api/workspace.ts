import { type NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, open, readdir, unlink, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs'
import { requireRole, type User } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/db'
import { AGENT_NAME_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  withTimeout,
  upstreamErrorBody,
  classifyEcsFailures,
} from '@/extensions/fleet/lib/aws-hardening'

/**
 * GET/PUT /api/fleet/agents/:name/workspace/:filename — post-deploy
 * persona editing (#377, memo `research/377-persona-editing-architecture.md`).
 *
 * Lets an admin read + write an agent's seeded persona/identity markdown
 * files on the shared EFS workspace mount, without SSH or hand-editing EFS.
 * MC reaches the files through the `/companion/openclaw` parent access point
 * mounted at the path in `MC_AGENT_WORKSPACE_ROOT` (ender-stack PR #548); the
 * resolved EFS-relative path is always `{agent}/workspace/<one of four files>`.
 *
 * Phase 1 is **admin-only** (memo §3 decision, locked with the issue owner):
 * MC has no per-agent ownership primitive today — `assignedUsers` does not
 * exist, and `ownerSlackId` is a write-once Slack handle baked into USER.md,
 * not an MC account. So the Owner tier of the §3 matrix cannot be enforced
 * yet. The READ/WRITE matrices below encode the full §3 contract so the Owner
 * rows light up unchanged once the MC-user↔agent ownership primitive lands
 * (tracked separately as the prerequisite for owner self-service). Until then
 * `requireRole(request, 'admin')` is the hard gate and the matrices reduce to
 * "admin may touch all four files."
 *
 * Concurrency (memo §2.3): the agent self-edits these same files, so MC is a
 * SECOND writer. GET returns a content hash; PUT must echo it (If-Match header
 * or `expected_hash` body field) and is rejected with 409 if the live file
 * changed since — optimistic concurrency that *prevents* a lost update rather
 * than only recording it after the fact. Writes are atomic: a per-request
 * unique temp file in the target dir, created O_EXCL, then renamed onto the
 * target, so a reader (or a concurrent PUT) never sees a torn file.
 *
 * Path safety is an exact allow-list (PERSONA_FILES), not a deny-list, so the
 * resolved path structurally cannot be `config/`, `.openclaw/`, `openclaw.json`,
 * or anything reached via `/`, `..`, or a leading `.`.
 */

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })

// Every response (success AND error) is no-store: the Settings editor is
// interactive and a caching proxy that cached a transient 404/409 would keep
// the editor wedged after the underlying file is fixed. Mirrors slack-channels.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * The four persona files seeded to every agent's workspace by the
 * workspace-defaults + archetype overlay (memo §1.2). TOOLS.md is intentionally
 * absent — it is not seeded today, so editing it would be a no-op (memo §1.3,
 * deferred). This list is the authoritative write/read allow-list.
 */
const PERSONA_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
] as const
type PersonaFile = (typeof PERSONA_FILES)[number]

/** Roles that can appear in the §3 matrix. `owner` is not yet a real MC role
 *  (see the file-level note); its rows are the forward contract. */
type EditorRole = User['role'] | 'owner'

/**
 * §3 READ matrix — who may GET which files. Read is deliberately a SEPARATE
 * matrix from write: an owner may *view* SOUL.md/AGENTS.md (needed for the
 * "request a change" affordance) but never PUT them.
 */
const READ_MATRIX: Partial<Record<EditorRole, readonly PersonaFile[]>> = {
  admin: PERSONA_FILES,
  // Phase-2 (owner self-service) — inert until the ownership primitive lands:
  owner: PERSONA_FILES,
}

/**
 * §3 WRITE matrix — who may PUT which files. SOUL.md + AGENTS.md are admin-only
 * because they carry the safety envelope (behavioral constraints, channel
 * segregation, heartbeat rules); an owner editing them would be a real liability.
 */
const WRITE_MATRIX: Partial<Record<EditorRole, readonly PersonaFile[]>> = {
  admin: PERSONA_FILES,
  // Phase-2 (owner self-service) — inert until the ownership primitive lands:
  owner: ['IDENTITY.md', 'USER.md'],
}

/**
 * Cap on persona-file size. These are human-authored markdown; 1 MiB is far
 * above any real persona file and bounds a pathological write. memory-core
 * indexes them on session start, so an enormous file would also bloat the agent.
 */
const MAX_PERSONA_BYTES = 1024 * 1024

export interface WorkspaceFileResponse {
  ok: true
  agentName: string
  filename: PersonaFile
  content: string
  /** sha256 of the current content; echo back as If-Match on PUT. */
  hash: string
}

export interface WorkspaceWriteResponse {
  ok: true
  agentName: string
  filename: PersonaFile
  /** sha256 of the newly-written content. */
  hash: string
  bytes: number
}

export interface WorkspaceErrorResponse {
  error: string
  detail?: string
  /** On 409 only: the current server-side hash so the client can refetch. */
  hash?: string
}

function computeHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Per-target-path async mutex. MC runs as a SINGLE ECS task (single-writer
 * deploy precondition), so serializing the read→hash-check→write critical
 * section in-process makes optimistic concurrency actually hold between two MC
 * writers: without it, two PUTs that read the same `expectedHash` would both
 * pass the 409 check and the later rename would silently drop the earlier edit
 * (Greptile P1 / pr-agent "Lost Update"). It also removes the temp-sweep race
 * (pr-agent): concurrent writes to the SAME file no longer overlap, so the
 * sweep can't delete another in-flight request's temp file.
 *
 * The agent is an EXTERNAL writer and can't take this lock — that residual
 * window (re-read → rename) is microseconds and unavoidable without NFS file
 * locking, which is unreliable on EFS. The hash re-check inside the lock makes
 * it as tight as is achievable; audit records `hashBefore` so any clobber is
 * reconstructable.
 */
const fileLocks = new Map<string, Promise<void>>()
function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = fileLocks.get(key) ?? Promise.resolve()
  const run = prior.then(fn, fn)
  const tail = run.then(
    () => {},
    () => {},
  )
  fileLocks.set(key, tail)
  // Bound the map: drop the entry once this is the tail and it has settled.
  tail.finally(() => {
    if (fileLocks.get(key) === tail) fileLocks.delete(key)
  })
  return run
}

/**
 * Normalize an `If-Match` header value to the bare hash. HTTP clients commonly
 * quote entity-tags (`If-Match: "<hash>"`) and may prefix a weak validator
 * (`W/"<hash>"`); strip both so an honest conditional write isn't rejected with
 * a spurious 409 (Greptile P2). The `expected_hash` body field is our own
 * contract and is used verbatim.
 */
function normalizeIfMatch(value: string | null): string | undefined {
  if (!value) return undefined
  let s = value.trim()
  if (s.startsWith('W/')) s = s.slice(2).trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  return s || undefined
}

function isPersonaFile(f: string): f is PersonaFile {
  return (PERSONA_FILES as readonly string[]).includes(f)
}

function jsonError(
  body: WorkspaceErrorResponse,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...extraHeaders },
  })
}

/**
 * Shared front-half of both handlers: auth (Phase-1 admin gate), agent-name +
 * filename validation, matrix check, env-root resolution, and the
 * MC-managed-agent two-tag guard. Returns either an early NextResponse (caller
 * returns it verbatim) or the resolved, validated paths + caller identity.
 */
async function resolveAndAuthorize(
  request: NextRequest,
  params: Promise<{ name: string; filename: string }>,
  matrix: Partial<Record<EditorRole, readonly PersonaFile[]>>,
  opts: { rateLimit?: boolean } = {},
): Promise<
  | { response: NextResponse }
  | {
      response?: never
      agentName: string
      filename: PersonaFile
      workspaceDir: string
      target: string
      actor: User
    }
> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return {
      response: jsonError({ error: auth.error ?? 'Unauthorized' }, auth.status ?? 401),
    }
  }

  // Rate-limit AFTER auth (mutating PUT only) so an unauthenticated flood from a
  // shared NAT can't burn the IP mutation bucket and 429 a legitimate admin —
  // matches the sibling fleet mutation handlers, which authenticate first
  // (Greptile P2). The GET read path is intentionally unthrottled.
  if (opts.rateLimit) {
    const rateCheck = mutationLimiter(request)
    if (rateCheck) return { response: rateCheck as NextResponse }
  }
  const actor = auth.user

  const { name: agentName, filename } = await params

  if (!agentName || !AGENT_NAME_RE.test(agentName)) {
    return {
      response: jsonError(
        {
          error: 'InvalidAgentName',
          detail: `agentName must match ${AGENT_NAME_RE.source}`,
        },
        400,
      ),
    }
  }

  if (!filename || !isPersonaFile(filename)) {
    return {
      response: jsonError(
        {
          error: 'InvalidFilename',
          detail: `filename must be one of: ${PERSONA_FILES.join(', ')}`,
        },
        400,
      ),
    }
  }

  // Matrix check. In Phase 1 only `admin` reaches here (requireRole gate), and
  // the admin rows cover all four files — but routing the decision through the
  // matrix keeps it load-bearing for the Owner tier without a code change.
  const allowed = matrix[actor.role as EditorRole] ?? []
  if (!allowed.includes(filename)) {
    return {
      response: jsonError(
        {
          error: 'Forbidden',
          detail: `role "${actor.role}" may not access ${filename}`,
        },
        403,
      ),
    }
  }

  const root = process.env.MC_AGENT_WORKSPACE_ROOT
  if (!root) {
    return {
      response: jsonError(
        {
          error: 'ConfigurationError',
          detail: 'MC_AGENT_WORKSPACE_ROOT is not configured',
        },
        500,
      ),
    }
  }

  // EFS-relative layout: {root}/{agent}/workspace/{file}. The allow-list above
  // already excludes traversal, but resolve()+prefix-check is defense-in-depth.
  const workspaceDir = resolve(root, agentName, 'workspace')
  const target = resolve(workspaceDir, filename)
  if (target !== workspaceDir + sep + filename) {
    return { response: jsonError({ error: 'InvalidFilename' }, 400) }
  }

  // Two-tag guard (Component=agent-harness AND ManagedBy=mission-control): an
  // admin may only edit MC-managed agents, never an arbitrary {name}/workspace
  // dir or a Terraform-owned service. Same boundary as the Slack handlers.
  const fleetPrefix = resolveFleetPrefix()
  const clusterName = fleetPrefix.clusterName
  const serviceName = `${fleetPrefix.prefix}-companion-openclaw-${agentName}`
  try {
    const describe = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName],
            include: ['TAGS'],
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    const classified = classifyEcsFailures(describe.failures)
    if (classified.hasNonMissing) {
      logger.error(
        {
          cluster: clusterName,
          serviceName,
          denied: classified.denied,
          other: classified.other,
        },
        '[fleet] workspace: DescribeServices returned non-MISSING failures (likely IAM denial)',
      )
      return { response: jsonError(upstreamErrorBody(), 502) }
    }
    const svc = describe.services?.[0]
    if (!svc || svc.status !== 'ACTIVE' || !isAgentHarness(svc)) {
      // 404 (not 403): refuse to confirm existence of a non-MC-managed service.
      return {
        response: jsonError(
          {
            error: 'ServiceNotFoundException',
            detail: `agent "${agentName}" not found`,
          },
          404,
        ),
      }
    }
  } catch (err) {
    const e = err as { name?: string; message?: string }
    logger.error(
      { cluster: clusterName, serviceName, agentName, errorName: e.name, errorMessage: e.message },
      '[fleet] workspace: AWS ECS error',
    )
    return { response: jsonError(upstreamErrorBody(), 502) }
  }

  return { agentName, filename, workspaceDir, target, actor }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; filename: string }> },
) {
  const resolved = await resolveAndAuthorize(request, params, READ_MATRIX)
  if (resolved.response) return resolved.response
  const { agentName, filename, target } = resolved

  try {
    // Size guard BEFORE reading into memory: the agent (or a direct EFS edit)
    // is also a writer and can create a file larger than PUT accepts, so a
    // blind readFile could pull an arbitrarily large blob into memory and JSON
    // (Greptile P2). stat first; reject oversized with a bounded 413.
    const st = await stat(target)
    if (st.size > MAX_PERSONA_BYTES) {
      return jsonError(
        {
          error: 'PayloadTooLarge',
          detail: `${filename} is ${st.size} bytes, over the ${MAX_PERSONA_BYTES}-byte cap; edit it directly on the workspace mount.`,
        },
        413,
      )
    }
    const content = await readFile(target, 'utf-8')
    return NextResponse.json(
      {
        ok: true,
        agentName,
        filename,
        content,
        hash: computeHash(content),
      } satisfies WorkspaceFileResponse,
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'ENOENT') {
      return jsonError(
        { error: 'FileNotFound', detail: `${filename} is not present in agent "${agentName}" workspace` },
        404,
      )
    }
    logger.error(
      { agentName, filename, errorCode: e.code, errorMessage: e.message },
      '[fleet] workspace GET: read failed',
    )
    return jsonError({ error: 'WorkspaceReadError' }, 502)
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; filename: string }> },
) {
  // Auth → rate-limit → ECS guard, all inside resolveAndAuthorize so the
  // mutation rate bucket is only spent by authenticated callers (Greptile P2).
  const resolved = await resolveAndAuthorize(request, params, WRITE_MATRIX, {
    rateLimit: true,
  })
  if (resolved.response) return resolved.response
  const { agentName, filename, workspaceDir, target, actor } = resolved

  // Body: { content: string, expected_hash?: string }. The expected hash may
  // also arrive as an `If-Match` header (mirrors HTTP conditional-write
  // semantics); the body field wins if both are present.
  let content: string
  let bodyExpectedHash: string | undefined
  try {
    const raw = (await request.json()) as unknown
    if (!raw || typeof raw !== 'object' || typeof (raw as { content?: unknown }).content !== 'string') {
      return jsonError(
        { error: 'InvalidRequestShape', detail: 'Body must be { content: string, expected_hash?: string }' },
        400,
      )
    }
    content = (raw as { content: string }).content
    const eh = (raw as { expected_hash?: unknown }).expected_hash
    if (typeof eh === 'string') bodyExpectedHash = eh
  } catch {
    return jsonError({ error: 'InvalidRequestBody', detail: 'Body is not valid JSON' }, 400)
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_PERSONA_BYTES) {
    return jsonError(
      { error: 'PayloadTooLarge', detail: `content exceeds the ${MAX_PERSONA_BYTES}-byte cap` },
      413,
    )
  }

  // Optimistic concurrency is REQUIRED: the agent is an active concurrent
  // writer, so a blind PUT could silently drop its edit. The caller must echo
  // the hash it read via GET (If-Match header — quotes/weak-validator tolerated
  // — or the expected_hash body field, which wins if both are present).
  const expectedHash =
    bodyExpectedHash ?? normalizeIfMatch(request.headers.get('if-match'))
  if (!expectedHash) {
    return jsonError(
      {
        error: 'PreconditionRequired',
        detail: 'Provide the current file hash via If-Match header or expected_hash body field (GET it first).',
      },
      428,
    )
  }

  const ipAddress =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown'

  // Serialize the read→hash-check→write critical section per target path so two
  // MC writers can't both pass the 409 check and clobber each other (the lock
  // also removes the temp-sweep race). See withFileLock for the full rationale.
  return withFileLock(target, async () => {
    // Read the live file: it must already exist (seeded on first boot). A
    // blank-file edit of a never-seeded file is out of scope for Phase 1.
    let current: string
    try {
      current = await readFile(target, 'utf-8')
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'ENOENT') {
        return jsonError(
          { error: 'FileNotFound', detail: `${filename} is not present in agent "${agentName}" workspace` },
          404,
        )
      }
      logger.error(
        { agentName, filename, errorCode: e.code, errorMessage: e.message },
        '[fleet] workspace PUT: read-before-write failed',
      )
      return jsonError({ error: 'WorkspaceReadError' }, 502)
    }

    const hashBefore = computeHash(current)
    if (expectedHash !== hashBefore) {
      return jsonError(
        {
          error: 'Conflict',
          detail: 'File changed since you last read it (the agent or another editor wrote it). Reload and reapply your edit.',
          hash: hashBefore,
        },
        409,
      )
    }

    const hashAfter = computeHash(content)
    const bytesAfter = Buffer.byteLength(content, 'utf8')

    // Best-effort sweep of orphaned temp files from a prior CRASHED write (an MC
    // OOM/kill between create and rename leaks `.{file}.*.tmp`). Safe under the
    // lock: no concurrent same-file write is in flight to have a live temp here.
    try {
      const entries = await readdir(workspaceDir)
      const stalePrefix = `.${filename}.`
      await Promise.all(
        entries
          .filter((e) => e.startsWith(stalePrefix) && e.endsWith('.tmp'))
          .map((e) => unlink(resolve(workspaceDir, e)).catch(() => {})),
      )
    } catch {
      // Non-fatal: the workspace dir always exists for an ACTIVE agent; a
      // readdir hiccup shouldn't block the write.
    }

    // Atomic write: per-request unique temp file in the TARGET dir, created
    // exclusively (O_EXCL via 'wx'), fsync'd, then renamed onto the target so a
    // reader never sees a torn file.
    const tmp = resolve(workspaceDir, `.${filename}.${randomUUID()}.tmp`)
    try {
      const fh = await open(tmp, 'wx')
      try {
        await fh.writeFile(content, 'utf-8')
        await fh.sync()
      } finally {
        await fh.close()
      }
      await rename(tmp, target)
      // Durability: fsync the parent dir so the new directory entry survives a
      // crash right after the response, not just the file content (Greptile P2).
      // Best-effort — on NFS/EFS the server owns durability and a dir fsync may
      // be a near no-op; a failure here must not fail an already-renamed write.
      try {
        const dh = await open(workspaceDir, 'r')
        try {
          await dh.sync()
        } finally {
          await dh.close()
        }
      } catch {
        // ignore — content + rename already persisted; dir-entry durability is
        // a best-effort hardening, not a correctness requirement.
      }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      await unlink(tmp).catch(() => {})
      logger.error(
        { agentName, filename, errorCode: e.code, errorMessage: e.message },
        '[fleet] workspace PUT: atomic write failed',
      )
      return jsonError({ error: 'WorkspaceWriteError' }, 502)
    }

    // Audit (memo §5b): rich record on the same rail gateway-config uses
    // (audit_log table + webhook broadcast). hashBefore makes a forced overwrite
    // reconstructable. Best-effort — a SQLite failure must not fail a write that
    // already landed on EFS (the file is authoritative).
    try {
      logAuditEvent({
        action: 'agent_persona_write',
        actor: actor.username,
        actor_id: actor.id,
        target_type: 'agent_workspace_file',
        detail: {
          agent: agentName,
          role: actor.role,
          file: filename,
          hashBefore,
          hashAfter,
          bytesBefore: Buffer.byteLength(current, 'utf8'),
          bytesAfter,
        },
        ip_address: ipAddress,
      })
    } catch (auditErr) {
      logger.warn(
        { err: auditErr, agentName, filename },
        '[fleet] workspace PUT: audit-log write failed after successful file write (response unaffected)',
      )
    }

    return NextResponse.json(
      {
        ok: true,
        agentName,
        filename,
        hash: hashAfter,
        bytes: bytesAfter,
      } satisfies WorkspaceWriteResponse,
      { status: 200, headers: NO_STORE },
    )
  })
}
