/**
 * Callback Payload Formatter
 *
 * Parses and normalises the structured payload Twin agents return inside a
 * task's `resolution` field (or occasionally `metadata.callback_payload`).
 *
 * Twin agents may return plain text OR a JSON object. When JSON, recognised
 * top-level fields are promoted to typed slots. Everything else lands in
 * `extra` so no data is silently dropped.
 *
 * This module is pure TypeScript — no React, no UI. The frontend agent owns
 * rendering; this file owns the data contract.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallbackFile {
  /** Original filename or path as returned by the agent */
  name: string
  /** Download URL if the agent provided one, otherwise null */
  url: string | null
  /** Bytes, if known */
  size: number | null
  /** MIME type, if known */
  mime: string | null
}

/**
 * Normalised, strongly-typed representation of a Twin agent callback payload.
 *
 * Fields map directly to what the review queue UI needs to render without
 * any further processing.
 */
export interface CallbackPayload {
  answer: string | null
  clickupTaskUrl: string | null
  files: CallbackFile[]
  extra: Record<string, unknown>
  isStructured: boolean
  cardSummary: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fields consumed into typed slots — excluded from `extra`. */
const CONSUMED_KEYS = new Set([
  'answer',
  'text',
  'response',
  'message',
  'clickup_task_url',
  'clickup_url',
  'files',
  'file',
])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseFile(raw: unknown): CallbackFile | null {
  if (typeof raw === 'string' && raw.trim()) {
    // Plain string — treat as name, derive URL if it looks like one
    const isUrl = /^https?:\/\//i.test(raw.trim())
    return { name: raw.trim(), url: isUrl ? raw.trim() : null, size: null, mime: null }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const name = String(o.name ?? o.filename ?? o.path ?? o.key ?? 'file')
    const url = typeof o.url === 'string' ? o.url : typeof o.download_url === 'string' ? o.download_url : null
    const size = typeof o.size === 'number' ? o.size : null
    const mime = typeof o.mime === 'string' ? o.mime : typeof o.content_type === 'string' ? o.content_type : null
    return { name, url, size, mime }
  }
  return null
}

function extractFiles(raw: unknown): CallbackFile[] {
  if (Array.isArray(raw)) {
    return raw.map(parseFile).filter((f): f is CallbackFile => f !== null)
  }
  const single = parseFile(raw)
  return single ? [single] : []
}

function extractAnswer(obj: Record<string, unknown>): string | null {
  for (const key of ['answer', 'text', 'response', 'message']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}


function extractCardSummary(obj: Record<string, unknown>): string[] {
  const raw = obj.card_summary ?? obj.cardSummary ?? obj.summary_bullets ?? obj.bullets
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return items
    .flatMap((item) => typeof item === 'string' ? [item] : [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function extractClickUpUrl(obj: Record<string, unknown>): string | null {
  for (const key of ['clickup_task_url', 'clickup_url']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a task's resolution string into a CallbackPayload.
 *
 * Accepts:
 *   - Plain text          → answer = text, everything else null/empty
 *   - JSON string         → fields promoted to typed slots
 *   - Pre-parsed object   → same field promotion
 *
 * Never throws. On any parse error falls back to treating input as plain text.
 */
export function parseCallbackPayload(resolution: string | null | undefined): CallbackPayload {
  if (!resolution || typeof resolution !== 'string' || !resolution.trim()) {
    return { answer: null, clickupTaskUrl: null, files: [], extra: {}, isStructured: false, cardSummary: [] }
  }

  const trimmed = resolution.trim()

  // Attempt JSON parse
  let obj: Record<string, unknown> | null = null
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>
      }
    } catch {
      // not JSON — handled below
    }
  }

  if (!obj) {
    // Plain text
    return {
      answer: trimmed,
      clickupTaskUrl: null,
      files: [],
      extra: {},
      isStructured: false,
      cardSummary: [],
    }
  }

  // Some agents wrap everything in a `result` envelope
  const root: Record<string, unknown> =
    obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)
      ? (obj.result as Record<string, unknown>)
      : obj

  const answer = extractAnswer(root)
  const clickupTaskUrl = extractClickUpUrl(root)
  const files = extractFiles(root.files ?? root.file)
  const cardSummary = extractCardSummary(root)

  // Collect unconsumed keys into extra
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(root)) {
    if (!CONSUMED_KEYS.has(k)) {
      extra[k] = v
    }
  }
  // If root was an envelope, also surface envelope-level fields not already in root
  if (root !== obj) {
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'result' && !CONSUMED_KEYS.has(k) && !(k in extra)) {
        extra[k] = v
      }
    }
  }

  return {
    answer,
    clickupTaskUrl,
    files,
    extra,
    isStructured: true,
    cardSummary,
  }
}

/**
 * Attempt to parse the callback payload from a task metadata object as well.
 *
 * Some Twin agents store a richer structured payload in metadata.callback_payload
 * rather than (or in addition to) the resolution field. This function merges
 * both sources, preferring the metadata payload for structured fields and
 * falling back to the resolution field for the answer text.
 */
export function parseTaskCallbackPayload(
  resolution: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): CallbackPayload {
  const fromResolution = parseCallbackPayload(resolution)

  const metaPayload = metadata?.callback_payload
  if (!metaPayload) return fromResolution

  const fromMeta = parseCallbackPayload(
    typeof metaPayload === 'string' ? metaPayload : JSON.stringify(metaPayload),
  )

  // Merge: prefer meta for structured fields, resolution for plain answer fallback
  return {
    answer: fromMeta.answer ?? fromResolution.answer,
    clickupTaskUrl: fromMeta.clickupTaskUrl ?? fromResolution.clickupTaskUrl,
    files: fromMeta.files.length > 0 ? fromMeta.files : fromResolution.files,
    extra: { ...fromResolution.extra, ...fromMeta.extra },
    isStructured: fromMeta.isStructured || fromResolution.isStructured,
    cardSummary: fromMeta.cardSummary.length > 0 ? fromMeta.cardSummary : fromResolution.cardSummary,
  }
}
