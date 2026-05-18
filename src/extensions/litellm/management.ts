/**
 * LiteLLM key-management API client — issue #354.
 *
 * Thin wrapper around the two LiteLLM proxy endpoints MC uses to
 * provision and revoke per-agent virtual keys:
 *   - `POST /key/generate` — creates a scoped virtual key with a
 *     deterministic `key_alias`, a model allowlist, and a monthly
 *     spend cap. Called from the fleet create-agent handler before
 *     any AWS resources are provisioned (a failure here aborts the
 *     create with zero orphans).
 *   - `POST /key/delete` — revokes a virtual key by alias. Called
 *     from the fleet delete-agent handler. A 404 from the proxy is
 *     treated as already-deleted (idempotent).
 *
 * Auth: the LiteLLM master key. Resolved by the caller from Secrets
 * Manager and passed in at constructor time. Never logged. Never
 * surfaced in responses.
 *
 * Errors: all non-2xx responses (and network failures) throw
 * `LiteLLMManagementError` with the original status, response body
 * text (truncated), and a flag for whether the failure is retriable
 * (5xx, 429, network) vs fatal (other 4xx). Retriable failures are
 * automatically retried inside `post()` up to `MAX_POST_ATTEMPTS`
 * with exponential backoff + jitter; only the final attempt's error
 * surfaces to the caller.
 */

const REQUEST_TIMEOUT_MS = 5_000
const BODY_TRUNCATION_LIMIT = 512
const MAX_POST_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 200

export interface GenerateKeyInput {
  /** Deterministic alias used to identify the key at delete time. */
  alias: string
  /** Model allowlist — LiteLLM rejects requests for any model outside the list. */
  models: string[]
  /** Monthly spend cap in USD. */
  maxBudget: number
}

export interface GenerateKeyResult {
  /** The generated virtual key (sk-…). Caller stores in Secrets Manager. */
  key: string
}

export interface DeleteKeyInput {
  alias: string
}

export class LiteLLMManagementError extends Error {
  // Round-11 audit (Claude): `bodySnippet` made non-enumerable via
  // Object.defineProperty (instead of the `public readonly` shorthand
  // which produces an enumerable own-property). This closes the
  // `{ ...err }`-spread leak path that round-10 documented as a
  // limitation: spread, Object.keys, Object.entries, and JSON-encoder
  // middleware that walks own-properties all skip non-enumerable
  // fields. Direct property access (`err.bodySnippet`) still works —
  // used by `isDuplicateAliasError` in the same module.
  declare readonly bodySnippet: string

  constructor(
    message: string,
    public readonly status: number,
    bodySnippet: string,
    public readonly retriable: boolean,
  ) {
    super(message)
    this.name = 'LiteLLMManagementError'
    Object.defineProperty(this, 'bodySnippet', {
      value: bodySnippet,
      writable: false,
      enumerable: false,
      configurable: false,
    })
  }

  /**
   * Round-9 audit (Claude Medium): defense-in-depth narrowing of
   * what gets serialized when this error class is stringified.
   *
   * Round-10 audit correction: pino's *default* error serializer
   * (`pino-std-serializers`) uses a fixed-field allowlist (type,
   * msg, stack, code) — it does NOT enumerate every own-property,
   * so a vanilla `logger.error({ err })` with project defaults
   * would not have leaked `bodySnippet` on its own. The risk this
   * toJSON() actually defends against is broader:
   *   1. Any direct `JSON.stringify(errInstance)` call —
   *      `bodySnippet`, `status`, and `retriable` ARE enumerable
   *      own-properties (Error.message and Error.name are not).
   *   2. Future logging middleware, error-reporting SDKs, or
   *      pino plugins that DO serialize all own-properties.
   *   3. `util.inspect` in test output formatters (visible in CI
   *      logs).
   *
   * `bodySnippet` matters for the rare 200-with-malformed-shape
   * branch: `bodySnippet = truncate(JSON.stringify(body))`
   * captures the full parsed response body. If a future LiteLLM
   * proxy ever echoes partial key material alongside a missing
   * `key` field, we don't want it to land anywhere downstream.
   *
   * The field stays accessible on the instance — the in-process
   * `isDuplicateAliasError` predicate reads it directly. Only
   * the serialized representation is narrowed.
   *
   * `Error.message` is intentionally kept — it carries only the
   * path + status code (e.g. "/key/generate returned 503"),
   * never response-body content.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      retriable: this.retriable,
    }
  }
}

export class LiteLLMManagementClient {
  constructor(
    private readonly baseUrl: string,
    private readonly masterKey: string,
  ) {
    if (!baseUrl) throw new Error('LiteLLMManagementClient: baseUrl required')
    if (!masterKey) throw new Error('LiteLLMManagementClient: masterKey required')
  }

  /**
   * Mint a key with retry-on-duplicate-alias semantics — round-2
   * audit on PR #68 (Greptile P1 + Claude "undefined behavior"):
   * a create-agent retry after a partial AWS failure re-runs step
   * 0.5 with the same deterministic `key_alias`. LiteLLM rejects
   * duplicate aliases by default, so a bare /key/generate would
   * 400 and the retry would be unrecoverable.
   *
   * On a duplicate-alias error this method calls /key/delete for
   * the alias first (idempotent), then re-tries /key/generate
   * once. The old key is rotated — acceptable because the
   * surrounding partial-failure state had already broken the
   * old key out of the agent's lifecycle.
   *
   * Only one rotation is attempted per call. A second consecutive
   * duplicate-alias error propagates as a hard failure (would
   * indicate LiteLLM internal state inconsistency).
   *
   * Round-3 audit on PR #68: this is the only public mint method.
   * The bare-mint variant was made private to remove the footgun
   * (a future caller reaching for "just give me a key" would get
   * the unsafe shape).
   *
   * Round-13 audit (concurrent-create TOCTOU note): in a multi-MC
   * deployment, two concurrent create-agent calls with the same
   * agentName can both pass the `agents.ts` step 0.4 DescribeServices
   * pre-flight, then race here:
   *   - Create-A mints first → alias registered.
   *   - Create-B sees duplicate alias 400 → /key/delete REVOKES
   *     Create-A's key → mints new key for B → returns success.
   *   - Create-A's already-written SM secret now references a
   *     revoked key. Its task-def boot will fail at first model
   *     call.
   * The agents.ts step 0.4 + Phase 2.2's single-MC posture make
   * this theoretical today. When multi-MC lands, the rotation
   * must be replaced by a "fail loud on duplicate alias from a
   * concurrent create" path, or guarded behind a distributed
   * lock. Tracked as a multi-MC follow-up.
   */
  async generateKeyWithRotation(
    input: GenerateKeyInput,
  ): Promise<GenerateKeyResult> {
    try {
      return await this.generateKeyOnce(input)
    } catch (err) {
      if (!(err instanceof LiteLLMManagementError)) throw err
      if (!isDuplicateAliasError(err)) throw err
      // Same-alias collision: delete the existing key (idempotent —
      // 404 is treated as already-gone by deleteKey), then retry.
      await this.deleteKey({ alias: input.alias })
      return await this.generateKeyOnce(input)
    }
  }

  private async generateKeyOnce(
    input: GenerateKeyInput,
  ): Promise<GenerateKeyResult> {
    const body = await this.post('/key/generate', {
      key_alias: input.alias,
      models: input.models,
      max_budget: input.maxBudget,
    })
    const key = (body as { key?: unknown }).key
    if (typeof key !== 'string' || !key) {
      throw new LiteLLMManagementError(
        '/key/generate returned no key field',
        200,
        truncate(JSON.stringify(body)),
        false,
      )
    }
    return { key }
  }

  /**
   * Revoke a key by alias. LiteLLM accepts either `keys: [<sk-…>]` or
   * `key_aliases: [<alias>]` — using aliases here so the delete path
   * can identify the key without first reading the per-agent secret.
   *
   * A 404 from the proxy (alias not found) is NOT thrown — returns
   * `{ alreadyDeleted: true }`. Matches the idempotent shape the
   * fleet delete handler uses for missing AWS resources.
   */
  async deleteKey(input: DeleteKeyInput): Promise<{ alreadyDeleted: boolean }> {
    try {
      await this.post('/key/delete', { key_aliases: [input.alias] })
      return { alreadyDeleted: false }
    } catch (err) {
      if (err instanceof LiteLLMManagementError && err.status === 404) {
        return { alreadyDeleted: true }
      }
      throw err
    }
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    let lastErr: LiteLLMManagementError | undefined
    for (let attempt = 1; attempt <= MAX_POST_ATTEMPTS; attempt++) {
      try {
        return await this.postOnce(path, payload)
      } catch (err) {
        if (!(err instanceof LiteLLMManagementError) || !err.retriable) throw err
        lastErr = err
        if (attempt < MAX_POST_ATTEMPTS) {
          const delay =
            RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) +
            Math.random() * RETRY_BASE_DELAY_MS
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    throw lastErr as LiteLLMManagementError
  }

  private async postOnce(path: string, payload: unknown): Promise<unknown> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.masterKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      throw new LiteLLMManagementError(
        `${path} network error: ${(err as Error).message}`,
        0,
        '',
        true,
      )
    } finally {
      clearTimeout(timer)
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new LiteLLMManagementError(
        `${path} returned ${resp.status}`,
        resp.status,
        truncate(text),
        resp.status >= 500 || resp.status === 429,
      )
    }

    try {
      return await resp.json()
    } catch (err) {
      throw new LiteLLMManagementError(
        `${path} returned non-JSON body: ${(err as Error).message}`,
        resp.status,
        '',
        false,
      )
    }
  }
}

function truncate(s: string): string {
  if (s.length <= BODY_TRUNCATION_LIMIT) return s
  return `${s.slice(0, BODY_TRUNCATION_LIMIT)}…[truncated ${s.length - BODY_TRUNCATION_LIMIT} chars]`
}

/**
 * Detect LiteLLM's "key_alias already exists" error. LiteLLM uses
 * 400 for this with a message that mentions the alias; no
 * structured error code is exposed.
 *
 * Round-3 audit on PR #68: pattern tightened to require the word
 * "alias" or "key_alias" in the match. The earlier loose middle
 * arm (`already exists`) would have matched unrelated 400s like
 * "model already exists in the allowlist" and silently rotated a
 * valid key. Each arm here is anchored to alias-specific
 * vocabulary.
 *
 * Version sensitivity: LiteLLM's error message text is not part
 * of a stable contract. The three alternations were validated
 * against LiteLLM proxy version `v1.83.14.rc.1` (the version
 * pinned in `services/litellm/Dockerfile` in ender-stack at the
 * time this regex was authored). If a proxy upgrade ships a new
 * message format, this regex stops matching → duplicate-alias
 * 400s propagate to the create-agent handler as a hard 502 (no
 * silent failure). Operator workaround: revoke the orphaned
 * alias via the LiteLLM dashboard, then retry create-agent. When
 * adding the new format, bump the version comment above so a
 * future reviewer can cross-check what's known-good.
 */
function isDuplicateAliasError(err: LiteLLMManagementError): boolean {
  if (err.status !== 400) return false
  return /key[_ ]alias.*already exists|duplicate.*key[_ ]alias|key[_ ]alias.*duplicate/i.test(
    err.bodySnippet,
  )
}
