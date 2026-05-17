'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  AGENT_NAME_MIN_LENGTH,
  AGENT_NAME_RE,
  DISPLAY_NAME_MAX_BYTES,
  HARNESS_TYPES,
  IMAGE_MAX_BYTES,
  OWNER_NAME_MAX_BYTES,
  OWNER_SLACK_ID_RE,
  OWNER_TZ_MAX_BYTES,
  PERSONA_FIELD_CONTROL_CHAR_RE,
  PERSONA_FIELD_DISALLOWED_PREFIX_RE,
  PERSONA_MAX_BYTES,
  PREFIX_TOO_LONG_ERROR,
  ROLE_DESCRIPTION_MAX_BYTES,
  type HarnessType,
} from '../templates/constraints'
import { ARCHETYPES } from '../templates/archetypes'
// `import type` only — keeps server-only modules (AWS SDK, NextRequest)
// out of the client bundle. Same pattern fleet-panel.tsx uses for the
// services-API response types.
import type {
  CreateAgentResponse,
  CreateAgentErrorResponse,
} from '../api/agents'
import type { HarnessDefaultsResponse } from '../api/harness-defaults'

// Phase 2.2 Beat 3b — UI form for POST /api/fleet/agents.
// Phase 2.2 Beat 3b.1 — converted from inline collapsible to portaled
// modal; pre-fills `image` from /api/fleet/harness-defaults; dropped
// the `modelTier` field (smart-router authoritative).
//
// Modal behavior:
//   - Rendered via React.createPortal into document.body so the modal
//     sits above the panel hierarchy regardless of z-index ancestors.
//   - Backdrop click + Esc key dismiss the form.
//   - Initial focus moves to the first input (agent name) on open;
//     focus returns to the trigger button on close.
//   - aria-modal + role="dialog" + aria-labelledby for screen-reader
//     correctness.
//
// Submit path:
//   POST /api/fleet/agents → on 201: render success summary + warnings,
//   call onCreated() so the parent refreshes the Fleet table.
//   On 4xx/5xx: render the SDK error name + partialResources if present.

interface Props {
  /** Whether the modal is currently visible. */
  open: boolean
  /** Called after a successful 201 so the parent panel can refresh the fleet table. */
  onCreated: () => void
  /** Called when the operator dismisses the modal (cancel, Esc, backdrop, or "Done" after success). */
  onClose: () => void
}

type FormState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; response: CreateAgentResponse }
  | { kind: 'error'; status: number; body: CreateAgentErrorResponse }

const HARNESS_TYPE_DEFAULT: HarnessType = HARNESS_TYPES[0]

// Soft cap on the create-agent fetch. The handler runs ≥6 sequential
// AWS API calls (RegisterTaskDefinition → CreateTargetGroup →
// DescribeRules → CreateRule → CreateLogGroup → CreateService); a
// degraded service would otherwise leave the form stuck "Creating…"
// with no way for the operator to bail. 30s gives a generous buffer
// over the realistic happy-path (~3-5s) without leaving the operator
// waiting on a hanging connection.
const SUBMIT_TIMEOUT_MS = 30_000

export function CreateAgentForm({ open, onCreated, onClose }: Props) {
  const [harnessType, setHarnessType] = useState<HarnessType>(
    HARNESS_TYPE_DEFAULT,
  )
  const [agentName, setAgentName] = useState('')
  const [image, setImage] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  // Optional persona fields. Default to '' — empty strings get OMITTED
  // from the POST body so the server treats them as undefined, matching
  // the "field absent" semantics the template expects for its
  // conditional env-var emission.
  const [displayName, setDisplayName] = useState('')
  const [persona, setPersona] = useState('')
  // #376: role archetype selection. Required field. Empty string means
  // the operator hasn't picked yet; submit is gated until they do.
  // `'custom'` is an explicit slug (in ARCHETYPES) — it selects the
  // free-form path where `persona` becomes the entire role definition.
  const [archetype, setArchetype] = useState('')
  // #376 owner-layer fields. ownerName + ownerSlackId required; tz
  // optional with browser-locale default (set in an effect below so
  // SSR doesn't see a value that differs from the client first paint).
  const [ownerName, setOwnerName] = useState('')
  const [ownerSlackId, setOwnerSlackId] = useState('')
  const [ownerTimezone, setOwnerTimezone] = useState('')
  const [state, setState] = useState<FormState>({ kind: 'idle' })
  // null = not yet fetched OR fetch failed; string = pre-fill ready.
  // Form treats null as "no default known"; operator types from scratch.
  const [defaultsByHarness, setDefaultsByHarness] = useState<
    Partial<Record<HarnessType, string>>
  >({})
  // Per-harness maxLength for agentName, computed server-side from
  // the deployment prefix so the form's input attribute is accurate
  // (default 32 = the regex max; the dynamic value is tighter when
  // the prefix forces it). Updated by the harness-defaults fetch.
  const [maxAgentNameByHarness, setMaxAgentNameByHarness] = useState<
    Partial<Record<HarnessType, number>>
  >({})
  // Surface harness-defaults endpoint failures (non-200) so operators
  // see WHY the form might be unsubmittable. Particularly important
  // for the PrefixTooLongForHarness 500 case — without this, the
  // form falls back to maxLength=32, looks normal, but every submit
  // fails the server-side cap with a confusing 400. Round-6 audit
  // upgraded this from "post-merge follow-up" to "should fix before
  // merge" — operator trap.
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  // When the deployment is misconfigured such that NO legal agent
  // name is creatable (PrefixTooLongForHarness), every submit will
  // 400 server-side. Disable submit entirely + change banner copy
  // from "may still go through" hedge to a definitive "cannot
  // create agents until X" message. Round-7 audit caught the
  // misleading hedge + the still-enabled Create button.
  const [defaultsErrorBlocksSubmit, setDefaultsErrorBlocksSubmit] = useState(false)

  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // Tracks whether the operator has manually edited `image` since the
  // modal last opened. Without this, a "select all + delete" to start
  // fresh would re-trigger the pre-fill effect (image → '' → effect
  // re-fires → snaps back to default), and the operator could never
  // empty the field after a default loaded. Round-2 audit caught
  // this — the previous `if (image !== '')` guard fired on
  // *intentional* clears too. Ref (not state) since the value isn't
  // user-visible and doesn't need to trigger re-renders.
  const imageEditedRef = useRef(false)

  const submitting = state.kind === 'submitting'

  // On open: capture the trigger element so we can return focus on
  // close, then move focus to the first input. On close: restore.
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement
    const t = setTimeout(() => firstInputRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      const target = previousFocusRef.current as HTMLElement | null
      target?.focus?.()
    }
  }, [open])

  // #376: pre-fill ownerTimezone from the browser's locale on open.
  // Runs inside an effect (not as the useState initial value) so SSR
  // hydration sees an empty string and doesn't mismatch the client's
  // resolved tz. Operator can override; empty string is allowed
  // (server treats absent ownerTimezone as undefined → no
  // AGENT_OWNER_TZ env var emitted).
  useEffect(() => {
    if (!open) return
    if (ownerTimezone) return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) setOwnerTimezone(tz)
    } catch {
      // Older browsers without Intl.DateTimeFormat fall through —
      // the operator can still type the value manually.
    }
  }, [open, ownerTimezone])

  // Reset on close so the next open shows a fresh form, not the
  // prior success/error view.
  //
  // The conditional-render → always-mounted refactor in this PR
  // dropped the unmount-on-close state teardown that React used to
  // do for free. Without this effect, a successful create followed
  // by close → reopen would show the previous agent's success
  // summary (with the wrong ARNs!) instead of an empty form.
  // Round-1 audit (Claude + Greptile P1) caught this.
  useEffect(() => {
    if (open) return
    setState({ kind: 'idle' })
    setAgentName('')
    setRoleDescription('')
    setDisplayName('')
    setPersona('')
    setArchetype('')
    setOwnerName('')
    setOwnerSlackId('')
    setOwnerTimezone('')
    setHarnessType(HARNESS_TYPE_DEFAULT)
    setImage('')
    setMaxAgentNameByHarness({})
    setDefaultsError(null)
    setDefaultsErrorBlocksSubmit(false)
    // Also clear the cached defaults so a fresh fetch on next open
    // is the only source of pre-fill. Otherwise: open → fetch
    // (cache populates) → close → reopen → close-effect sets
    // image='' BUT defaultsByHarness still has the old cached
    // value → pre-fill effect synchronously applies the stale
    // default → fetch returns fresh value → guard `image !== ''`
    // blocks the update → operator sees stale image. Round-3
    // audit P2.
    setDefaultsByHarness({})
    // Reset the edited flag too so the next open re-pre-fills from
    // defaults (operator's intent from the closed-out session
    // doesn't leak into the next).
    imageEditedRef.current = false
  }, [open])

  // Focus trap (WAI-ARIA 1.2 Dialog Pattern §2.25). Without this,
  // Tab/Shift+Tab from inside the modal escapes into background
  // panel content. Collect focusable descendants on every Tab keydown
  // (cheap; modal has ~6-8 tabbable elements) and cycle.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Esc to dismiss. Only attached while open. Submit-in-flight blocks
  // dismiss to avoid losing the in-flight create — operator must wait
  // for the response (success/error) before closing.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  // Pre-fill `image` from /api/fleet/harness-defaults on first open.
  // The endpoint MAY 500 with PrefixTooLongForHarness on a deployment
  // misconfig — surface that to the operator via `defaultsError` so
  // they don't see a working-looking form that fails every submit.
  // For the missing-default case (DescribeServices returns no
  // smoke-test, etc.), the endpoint returns 200 with
  // `defaultImage: null` and the operator just types the image
  // manually — no error needed.
  //
  // AbortController matches the submit-path pattern. On quick
  // open→close (accidental click), the in-flight fetch is cancelled
  // immediately rather than running for the server-side 5s timeout
  // window before being silently dropped at the client.
  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    void (async () => {
      try {
        const resp = await fetch('/api/fleet/harness-defaults', {
          cache: 'no-store',
          signal: ac.signal,
        })
        if (!resp.ok) {
          // Try to extract the error code + detail so operators
          // know exactly what's misconfigured (e.g. the
          // PrefixTooLongForHarness 500 names the offending prefix
          // in detail). Falls back to a generic message if the body
          // isn't JSON or doesn't match the expected shape.
          let code = `HTTP ${resp.status}`
          let detail = ''
          try {
            const errBody = (await resp.json()) as
              | { error?: string; detail?: string }
              | undefined
            if (errBody?.error) code = errBody.error
            if (errBody?.detail) detail = errBody.detail
          } catch {
            // body not JSON — keep the generic code
          }
          if (ac.signal.aborted) return
          setDefaultsError(detail ? `${code}: ${detail}` : code)
          // PrefixTooLongForHarness means NO legal agent name fits
          // under the AWS 32-char cap given this prefix — every
          // submit will 400. Block submit definitively. Other 5xx
          // codes (e.g. transient AWS API failures upstream of the
          // ECS lookup) leave submit enabled — the operator can
          // still type a name that the server-side gate accepts.
          if (code === PREFIX_TOO_LONG_ERROR) {
            setDefaultsErrorBlocksSubmit(true)
          }
          return
        }
        const body = (await resp.json()) as HarnessDefaultsResponse
        if (ac.signal.aborted) return
        const nextImages: Partial<Record<HarnessType, string>> = {}
        const nextMaxLengths: Partial<Record<HarnessType, number>> = {}
        for (const h of HARNESS_TYPES) {
          const d = body.defaults[h]?.defaultImage
          if (typeof d === 'string') nextImages[h] = d
          const m = body.defaults[h]?.agentNameMaxLength
          // Belt-and-suspenders: require maxLength >= the regex
          // minimum, not just > 0. Server's PrefixTooLongForHarness
          // 500 is the primary gate (caught before this point), but
          // if a future server bug ever returned a positive but
          // sub-minimum value, the form would set maxLength <
          // minLength and trap operators in an unsubmittable state.
          if (typeof m === 'number' && m >= AGENT_NAME_MIN_LENGTH) {
            nextMaxLengths[h] = m
          }
        }
        setDefaultsByHarness(nextImages)
        setMaxAgentNameByHarness(nextMaxLengths)
      } catch {
        // AbortError + network/JSON failures all silent — the
        // operator can still type the image manually.
      }
    })()
    return () => {
      ac.abort()
    }
  }, [open])

  // When defaults arrive (or harness selection changes), pre-fill
  // `image` IFF the operator hasn't manually edited the field this
  // session. The flag (not the field's empty-ness) is the gate so
  // an intentional clear doesn't re-trigger the pre-fill —
  // round-2 audit caught the empty-string-as-gate bug.
  useEffect(() => {
    if (imageEditedRef.current) return
    const d = defaultsByHarness[harnessType]
    if (d && image === '') setImage(d)
  }, [defaultsByHarness, harnessType, image])

  // Local pre-validation before POSTing — catches the obvious failures
  // without a network round-trip. Server-side validation (in
  // templates/index.ts validateOpenClawInput + agents.ts type guard +
  // the prefix-aware target-group-name length cap) is still the
  // authoritative gate; this layer is UX-only. Keep the rules in
  // lockstep with constraints.ts.
  //
  // `agentNameMaxForHarness` is the per-deployment cap from the
  // harness-defaults endpoint (computed from the actual prefix so a
  // shorter fork prefix gets a longer cap). Defaults to 32 (the regex
  // upper bound) when the endpoint hasn't responded yet; the server
  // is the authoritative gate either way.
  const agentNameMaxForHarness =
    maxAgentNameByHarness[harnessType] ?? 32
  const agentNameValid =
    AGENT_NAME_RE.test(agentName) &&
    agentName.length <= agentNameMaxForHarness
  // image must contain a separator AND have something after it.
  // `img:` (empty tag) passes a naive `includes(':')` check but
  // ECS rejects it as InvalidParameterException at registration —
  // catch it client-side so the operator gets immediate feedback
  // instead of a confusing 502 round-trip.
  const lastTagSegment = image.split(':').at(-1) ?? ''
  const imageValid =
    image.length > 0 &&
    image.includes(':') &&
    lastTagSegment.length > 0 &&
    image.length <= IMAGE_MAX_BYTES
  // UTF-8 byte length helper. Greptile P2 on PR #69: pre-fix the form
  // compared `.length` (UTF-16 code units) against byte caps, so e.g.
  // 1024 `é` characters (1024 code units → 2048 UTF-8 bytes) passed
  // the form but exceeded the server cap. Browser TextEncoder is in
  // every modern browser (Node 18+ also has it as a global) so the
  // dependency is free.
  const utf8Bytes = (s: string) => new TextEncoder().encode(s).length
  const roleDescriptionBytes = utf8Bytes(roleDescription)
  const displayNameBytes = utf8Bytes(displayName)
  const personaBytes = utf8Bytes(persona)
  // Mirror the server-side guards (templates/index.ts validatePersonaField
  // + validateProseField) client-side so operators see immediate
  // feedback instead of a 400 after submit. Regex constants IMPORTED
  // from constraints.ts (not copied) so a future tightening — e.g.
  // adding `^> ` blockquote rejection — updates both layers in
  // lockstep automatically.
  const hasProseControlChar = (s: string) => {
    if (!PERSONA_FIELD_CONTROL_CHAR_RE.test(s)) return false
    return PERSONA_FIELD_CONTROL_CHAR_RE.test(s.replace(/[\n\t]/g, ''))
  }
  // roleDescription applies the prefix check on the TRIMMED START only
  // (LF/tab in the middle of the value is fine — operators want
  // multi-line prose; init-config normField collapses newlines at the
  // boot boundary). A leading `- foo` would otherwise land as
  // `Role: - foo` after the collapse — almost always an injection
  // attempt rather than a real role.
  const roleDescriptionValid =
    roleDescription.trim().length > 0 &&
    roleDescriptionBytes <= ROLE_DESCRIPTION_MAX_BYTES &&
    !hasProseControlChar(roleDescription) &&
    !PERSONA_FIELD_DISALLOWED_PREFIX_RE.test(roleDescription.trim())
  // Optional fields. Empty = field omitted (server treats as undefined).
  // Each capped by UTF-8 byte count, not code units. Trim before the
  // list-item-prefix check so client/server agree.
  const displayNameValid =
    displayNameBytes <= DISPLAY_NAME_MAX_BYTES &&
    !PERSONA_FIELD_DISALLOWED_PREFIX_RE.test(displayName.trim()) &&
    !PERSONA_FIELD_CONTROL_CHAR_RE.test(displayName)
  // #376: archetype is required (one of the slugs in ARCHETYPES). When
  // operator picks `custom`, persona becomes required too — without a
  // role scaffold + without operator-supplied persona, the agent would
  // boot with the base personal-assistant defaults, which #376 exists
  // to move away from.
  const archetypeValid = ARCHETYPES.some((a) => a.slug === archetype)
  const personaRequiredForArchetype = archetype === 'custom'
  const personaValid =
    personaBytes <= PERSONA_MAX_BYTES &&
    !hasProseControlChar(persona) &&
    (!personaRequiredForArchetype || persona.trim().length > 0)
  // #376: owner-layer fields. ownerName + ownerSlackId required;
  // timezone optional with browser-default pre-fill.
  const ownerNameBytes = utf8Bytes(ownerName)
  const ownerTimezoneBytes = utf8Bytes(ownerTimezone)
  const ownerNameValid =
    ownerName.trim().length > 0 &&
    ownerNameBytes <= OWNER_NAME_MAX_BYTES &&
    !PERSONA_FIELD_DISALLOWED_PREFIX_RE.test(ownerName.trim()) &&
    !PERSONA_FIELD_CONTROL_CHAR_RE.test(ownerName)
  const ownerSlackIdValid = OWNER_SLACK_ID_RE.test(ownerSlackId)
  const ownerTimezoneValid =
    ownerTimezone === '' ||
    (ownerTimezoneBytes <= OWNER_TZ_MAX_BYTES &&
      !PERSONA_FIELD_DISALLOWED_PREFIX_RE.test(ownerTimezone.trim()) &&
      !PERSONA_FIELD_CONTROL_CHAR_RE.test(ownerTimezone))
  const formValid =
    agentNameValid &&
    imageValid &&
    roleDescriptionValid &&
    displayNameValid &&
    personaValid &&
    archetypeValid &&
    ownerNameValid &&
    ownerSlackIdValid &&
    ownerTimezoneValid &&
    !defaultsErrorBlocksSubmit

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formValid || submitting) return
    setState({ kind: 'submitting' })

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), SUBMIT_TIMEOUT_MS)

    let resp: Response
    try {
      resp = await fetch('/api/fleet/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: ac.signal,
        body: JSON.stringify({
          harnessType,
          agentName,
          image,
          roleDescription,
          // Omit empty optionals so the server gets `undefined` (the
          // template's conditional-emission branch doesn't fire and the
          // task-def stays clean for agents that didn't supply persona
          // fields).
          ...(displayName ? { displayName } : {}),
          ...(persona ? { persona } : {}),
          // #376: archetype + owner fields. archetype is required so
          // it's always emitted (formValid gates submit). Owner fields
          // are submitted when non-empty; the server treats absent
          // optionals as undefined.
          archetype,
          ownerName,
          ownerSlackId,
          ...(ownerTimezone ? { ownerTimezone } : {}),
        }),
      })
    } catch (err) {
      // Network failure or timeout — no `Response` was received, so
      // there's no HTTP status to surface. status=0 is the correct
      // "we never got past the wire" sentinel here. AbortError fires
      // when SUBMIT_TIMEOUT_MS elapses; surface a clearer name so
      // operators distinguish a hard timeout from a generic network
      // glitch.
      const name = (err as Error).name
      const code = name === 'AbortError' ? 'SubmitTimeout' : name || 'NetworkError'
      setState({ kind: 'error', status: 0, body: { error: code } })
      return
    } finally {
      clearTimeout(timer)
    }

    // From this point we DO have a Response — `resp.status` must
    // surface even if JSON parse fails (e.g. proxy returned HTML on a
    // 502). Splitting the JSON parse into its own try/catch lets the
    // operator see "502 — ResponseParseError" instead of the
    // misleading "0 — SyntaxError" the unified catch produced.
    let body: CreateAgentResponse | CreateAgentErrorResponse
    try {
      body = (await resp.json()) as
        | CreateAgentResponse
        | CreateAgentErrorResponse
    } catch {
      setState({
        kind: 'error',
        status: resp.status,
        body: { error: 'ResponseParseError' },
      })
      return
    }

    if (resp.ok && 'ok' in body && body.ok) {
      setState({ kind: 'success', response: body })
      onCreated()
    } else {
      setState({
        kind: 'error',
        status: resp.status,
        body: body as CreateAgentErrorResponse,
      })
    }
  }

  function reset() {
    setAgentName('')
    // "Create another" — preserve the operator's last harness
    // selection (likely creating multiple agents of the same type)
    // and pre-fill the image from THAT harness's default, not the
    // default-default. With a single harness today this is
    // equivalent to HARNESS_TYPE_DEFAULT, but it's the correct
    // shape when a second harness lands. Round-9 audit P3.
    setImage(defaultsByHarness[harnessType] ?? '')
    setRoleDescription('')
    setDisplayName('')
    setPersona('')
    setArchetype('')
    setOwnerName('')
    setOwnerSlackId('')
    // ownerTimezone is preserved across Create-another — the browser
    // tz is unchanged + the operator probably wants the same default
    // for the next agent. They can edit if needed.
    setState({ kind: 'idle' })
    // "Create another" treats the just-applied default as the
    // canonical starting point; the operator hasn't edited yet.
    imageEditedRef.current = false
  }

  function handleHarnessChange(next: HarnessType) {
    setHarnessType(next)
    // Switching harness should re-arm the pre-fill effect — the new
    // harness's default may differ. Clearing the image too so the
    // pre-fill effect's `image === ''` gate fires. Latent for the
    // single-harness phase, correct for harness-2. Round-9 audit P3.
    setImage('')
    imageEditedRef.current = false
  }

  function handleImageChange(value: string) {
    setImage(value)
    imageEditedRef.current = true
  }

  function handleBackdropClick() {
    if (submitting) return
    onClose()
  }

  if (!open) return null

  // Render outside the panel hierarchy — sits above any z-index
  // ancestor, dimmed backdrop covers the whole viewport.
  return createPortal(
    <div
      role="presentation"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="create-agent-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border bg-background shadow-xl"
        data-testid="create-agent-modal"
      >
        <FormBody
          state={state}
          submitting={submitting}
          harnessType={harnessType}
          setHarnessType={handleHarnessChange}
          agentName={agentName}
          setAgentName={setAgentName}
          agentNameValid={agentNameValid}
          agentNameMaxForHarness={agentNameMaxForHarness}
          image={image}
          onImageChange={handleImageChange}
          imageValid={imageValid}
          roleDescription={roleDescription}
          setRoleDescription={setRoleDescription}
          displayName={displayName}
          setDisplayName={setDisplayName}
          persona={persona}
          setPersona={setPersona}
          archetype={archetype}
          setArchetype={setArchetype}
          ownerName={ownerName}
          setOwnerName={setOwnerName}
          ownerSlackId={ownerSlackId}
          setOwnerSlackId={setOwnerSlackId}
          ownerTimezone={ownerTimezone}
          setOwnerTimezone={setOwnerTimezone}
          formValid={formValid}
          firstInputRef={firstInputRef}
          onSubmit={handleSubmit}
          onClose={onClose}
          onResetForCreateAnother={reset}
          defaultsError={defaultsError}
          defaultsErrorBlocksSubmit={defaultsErrorBlocksSubmit}
        />
      </div>
    </div>,
    document.body,
  )
}

/**
 * Visual marker on field labels that the field is required. Asterisk
 * is the established convention for sighted users. Marked
 * `aria-hidden="true"` because the canonical screen-reader signal
 * is the input's native `required` attribute — the asterisk is
 * presentational supplement, not the semantic source of truth.
 * (Round-1 audit on PR #39 flagged that aria-label="required" duped
 * the native required attribute; aria-hidden is the conventional
 * pattern for purely decorative requirement markers.)
 */
function RequiredMark() {
  return (
    <span
      className="text-destructive ml-0.5"
      aria-hidden="true"
      data-testid="required-mark"
    >
      *
    </span>
  )
}

interface FormBodyProps {
  state: FormState
  submitting: boolean
  harnessType: HarnessType
  setHarnessType: (h: HarnessType) => void
  agentName: string
  setAgentName: (s: string) => void
  agentNameValid: boolean
  agentNameMaxForHarness: number
  image: string
  onImageChange: (s: string) => void
  imageValid: boolean
  roleDescription: string
  setRoleDescription: (s: string) => void
  /** Optional persona fields. Empty string = field omitted; the parent
   *  strips empties from the POST body so the template's conditional
   *  emission stays accurate. */
  displayName: string
  setDisplayName: (s: string) => void
  persona: string
  setPersona: (s: string) => void
  /** #376: role archetype slug. Required field — one of the slugs in
   *  ARCHETYPES (technical-support / software-engineer / .../ custom).
   *  Empty string until the operator picks. */
  archetype: string
  setArchetype: (s: string) => void
  /** #376: owner-layer fields. ownerName + ownerSlackId required;
   *  ownerTimezone optional with browser-locale default. */
  ownerName: string
  setOwnerName: (s: string) => void
  ownerSlackId: string
  setOwnerSlackId: (s: string) => void
  ownerTimezone: string
  setOwnerTimezone: (s: string) => void
  formValid: boolean
  firstInputRef: React.MutableRefObject<HTMLInputElement | null>
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  onResetForCreateAnother: () => void
  /** Non-null when the harness-defaults endpoint returned non-200.
   *  Format: `<error-code>: <detail>` from the response body, or
   *  `HTTP <status>` if the body wasn't parseable. Surfaces a banner
   *  above the form so operators see deployment misconfigs (e.g.
   *  PrefixTooLongForHarness) rather than a working-looking form
   *  that fails every submit. */
  defaultsError: string | null
  /** True when the defaults error means NO legal agent name is
   *  creatable (today: PrefixTooLongForHarness). Disables submit
   *  + uses a definitive banner copy. */
  defaultsErrorBlocksSubmit: boolean
}

function FormBody({
  state,
  submitting,
  harnessType,
  setHarnessType,
  agentName,
  setAgentName,
  agentNameValid,
  agentNameMaxForHarness,
  image,
  onImageChange,
  imageValid,
  roleDescription,
  setRoleDescription,
  displayName,
  setDisplayName,
  persona,
  setPersona,
  archetype,
  setArchetype,
  ownerName,
  setOwnerName,
  ownerSlackId,
  setOwnerSlackId,
  ownerTimezone,
  setOwnerTimezone,
  formValid,
  firstInputRef,
  onSubmit,
  onClose,
  onResetForCreateAnother,
  defaultsError,
  defaultsErrorBlocksSubmit,
}: FormBodyProps) {
  // UTF-8 byte counts for the byte-capped fields (Greptile P2 on
  // PR #69). Computed inside FormBody so the JSX can reference them
  // without threading 4 more props from the parent. The cap-vs-bytes
  // check at form-submit time lives in the parent's formValid.
  const utf8Bytes = (s: string) => new TextEncoder().encode(s).length
  const roleDescriptionBytes = utf8Bytes(roleDescription)
  const displayNameBytes = utf8Bytes(displayName)
  const personaBytes = utf8Bytes(persona)
  // #376: byte counts for the new owner-layer + archetype-aware fields.
  const ownerNameBytes = utf8Bytes(ownerName)
  const ownerTimezoneBytes = utf8Bytes(ownerTimezone)
  // Selected archetype manifest (for the preview card). undefined while
  // the operator hasn't picked.
  const selectedArchetype = ARCHETYPES.find((a) => a.slug === archetype)
  const personaRequired = archetype === 'custom'
  if (state.kind === 'success') {
    const r = state.response
    return (
      <div
        className="p-6"
        data-testid="create-agent-success"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="create-agent-title" className="text-lg font-medium text-green-700">
            Agent <code>{r.agentName}</code> created
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 mb-3">
          <dt className="text-muted-foreground">Service</dt>
          <dd className="font-mono break-all">{r.resources.serviceArn}</dd>
          <dt className="text-muted-foreground">Task definition</dt>
          <dd className="font-mono break-all">
            {r.resources.taskDefinitionArn}
          </dd>
          <dt className="text-muted-foreground">Target group</dt>
          <dd className="font-mono break-all">{r.resources.targetGroupArn}</dd>
          <dt className="text-muted-foreground">Listener rule</dt>
          <dd className="font-mono break-all">{r.resources.listenerRuleArn}</dd>
          <dt className="text-muted-foreground">Log group</dt>
          <dd className="font-mono">{r.resources.logGroup}</dd>
          <dt className="text-muted-foreground">Listener path</dt>
          <dd className="font-mono">{r.resources.listenerPath}</dd>
        </dl>
        {r.warnings.length > 0 && (
          <div
            className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs mb-3"
            data-testid="create-agent-warnings"
          >
            <div className="font-medium mb-1">
              Warnings ({r.warnings.length})
            </div>
            <ul className="list-disc list-inside space-y-1">
              {r.warnings.map((w) => (
                <li key={w.code}>
                  <code className="text-amber-700">{w.code}</code>
                  {' — '}
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onResetForCreateAnother}>
            Create another
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="p-6 space-y-4"
      data-testid="create-agent-form"
    >
      <div className="flex items-center justify-between">
        <h2 id="create-agent-title" className="text-lg font-medium">
          Create agent
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Close create-agent form"
        >
          ✕
        </button>
      </div>

      {defaultsError && (
        <div
          role="alert"
          className={
            defaultsErrorBlocksSubmit
              ? 'rounded border border-destructive/50 bg-destructive/10 p-3 text-sm'
              : 'rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm'
          }
          data-testid="create-agent-defaults-error"
        >
          <div
            className={
              defaultsErrorBlocksSubmit
                ? 'font-medium text-destructive mb-1'
                : 'font-medium text-amber-700 mb-1'
            }
          >
            {defaultsErrorBlocksSubmit
              ? 'Cannot create agents — deployment misconfigured'
              : 'Form pre-fill unavailable'}
          </div>
          <div className="text-xs">
            <code>{defaultsError}</code>
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {defaultsErrorBlocksSubmit ? (
              <>
                The deployment prefix leaves no room for any legal
                agent name under the AWS 32-char target-group-name
                limit. Submit is disabled until the prefix is fixed.
                Check MC logs for the offending value.
              </>
            ) : (
              <>
                The deployment&apos;s harness defaults endpoint
                failed. Per-deployment constraints (e.g. agent name
                length cap) won&apos;t be enforced client-side, but
                the server-side gate still applies — submissions
                will be validated there. Check MC logs for details.
              </>
            )}
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm"
          data-testid="create-agent-error"
        >
          <div className="font-medium text-destructive">
            {state.status > 0 ? `${state.status} — ` : ''}
            <code>{state.body.error}</code>
          </div>
          {state.body.partialResources &&
            Object.keys(state.body.partialResources).length > 0 && (
              <div className="text-xs mt-2">
                <div className="text-muted-foreground mb-1">
                  Partial resources created (clean up before retrying):
                </div>
                <ul className="list-disc list-inside font-mono break-all space-y-0.5">
                  {state.body.partialResources.taskDefinitionArn && (
                    <li>{state.body.partialResources.taskDefinitionArn}</li>
                  )}
                  {state.body.partialResources.targetGroupArn && (
                    <li>{state.body.partialResources.targetGroupArn}</li>
                  )}
                  {state.body.partialResources.listenerRuleArn && (
                    <li>{state.body.partialResources.listenerRuleArn}</li>
                  )}
                  {state.body.partialResources.logGroup && (
                    <li>{state.body.partialResources.logGroup}</li>
                  )}
                  {/* `serviceArn` may be null (not undefined) when the
                      backend caught a CreateService SDK contract
                      violation — see the `partial.serviceArn = null`
                      assignment in api/agents.ts on the
                      "CreateService returned no ARN" path. The truthy
                      check on the other ARNs above would skip null;
                      use `'serviceArn' in partialResources` so the
                      operator gets a clear "possibly-orphaned
                      service" signal even when the ARN itself is
                      unknown. */}
                  {'serviceArn' in state.body.partialResources && (
                    <li
                      className="text-amber-700 not-italic"
                      data-testid="partial-service-arn-warning"
                    >
                      {typeof state.body.partialResources.serviceArn ===
                      'string' ? (
                        state.body.partialResources.serviceArn
                      ) : (
                        <>
                          Service ARN unknown — run{' '}
                          <code className="font-mono">
                            aws ecs describe-services --cluster
                            &lt;cluster&gt; --services
                            &lt;prefix&gt;-{harnessType.replace('/', '-')}-{
                              agentName || '<name>'
                            }
                          </code>{' '}
                          to check for an orphaned service before retrying.
                        </>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}
        </div>
      )}

      <div>
        <label
          htmlFor="harnessType"
          className="block text-sm font-medium mb-1.5"
        >
          Harness type
        </label>
        <select
          id="harnessType"
          value={harnessType}
          onChange={(e) => setHarnessType(e.target.value as HarnessType)}
          disabled={submitting}
          className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
        >
          {HARNESS_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="agentName" className="block text-sm font-medium mb-1.5">
          Agent name <RequiredMark />
        </label>
        <input
          id="agentName"
          ref={firstInputRef}
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          disabled={submitting}
          required
          minLength={3}
          maxLength={agentNameMaxForHarness}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
          placeholder="my-agent-1"
          aria-describedby="agentName-hint"
        />
        <p
          id="agentName-hint"
          className={`mt-1 text-xs ${
            agentName.length > 0 && !agentNameValid
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          Lowercase letters, digits, hyphens. Must start and end with a
          letter or digit (no leading/trailing hyphens). 3–
          {agentNameMaxForHarness} chars.
          {agentNameMaxForHarness < 32 && (
            <>
              {' '}
              The AWS target-group name <code>{`{prefix}-agent-{name}`}</code>{' '}
              is capped at 32 chars; this deployment&apos;s prefix
              overhead leaves {agentNameMaxForHarness} chars for the
              agent-name segment.
            </>
          )}{' '}
          Date prefixes like <code>2026-04-30</code> work as long as
          the total fits. Used in IAM ARN templating — security
          control, not just a UX validator.
        </p>
      </div>

      <div>
        <label htmlFor="image" className="block text-sm font-medium mb-1.5">
          Container image <RequiredMark />
        </label>
        <input
          id="image"
          type="text"
          value={image}
          onChange={(e) => onImageChange(e.target.value)}
          disabled={submitting}
          required
          maxLength={IMAGE_MAX_BYTES}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
          placeholder="ghcr.io/stroupaloop/openclaw:sha-abc1234"
          aria-describedby="image-hint"
        />
        <p
          id="image-hint"
          className={`mt-1 text-xs ${
            image.length > 0 && !imageValid
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          Pre-filled from the most-recent OpenClaw image on this
          cluster (override only when you need a specific build).
          Must be a fully-qualified ref with a non-empty tag or
          digest. Server enforces a registry allowlist
          (ECR-in-account, ghcr.io/stroupaloop). Max{' '}
          {IMAGE_MAX_BYTES} chars.
        </p>
      </div>

      <div>
        <label
          htmlFor="roleDescription"
          className="block text-sm font-medium mb-1.5"
        >
          Role description <RequiredMark />
        </label>
        <textarea
          id="roleDescription"
          value={roleDescription}
          onChange={(e) => setRoleDescription(e.target.value)}
          disabled={submitting}
          required
                    rows={4}
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
          placeholder="What this agent does, who it serves, what guardrails apply…"
          aria-describedby="roleDescription-hint"
        />
        <p
          id="roleDescription-hint"
          className="mt-1 text-xs text-muted-foreground"
        >
          <span className={roleDescriptionBytes > ROLE_DESCRIPTION_MAX_BYTES ? 'text-destructive' : ''}>
            {roleDescriptionBytes}/{ROLE_DESCRIPTION_MAX_BYTES} bytes (UTF-8).
          </span>{' '}
          Shapes the agent&apos;s behavior as part of its system context
          AND becomes the <code>Role:</code> bullet in{' '}
          <code>IDENTITY.md</code>. Also shown as the bot&apos;s
          description in the Slack app directory (truncated to 140
          characters). Be specific: &ldquo;Handles procurement PO intake
          for the Chicago office&rdquo; works better than &ldquo;Helps
          with stuff.&rdquo; Written into an immutable task-def revision
          visible to anyone with <code>ecs:DescribeTaskDefinition</code> —
          treat as permanent + public.
        </p>
      </div>

      {/* #376: Role archetype selection. Required field. The
          selected archetype's SOUL.md / AGENTS.md overlay is layered
          ABOVE the base workspace-defaults templates by init-config at
          boot. Custom = no overlay; operator-supplied persona becomes
          the entire role definition. */}
      <div className="border-t pt-4 mt-2">
        <div className="mb-3">
          <label
            htmlFor="archetype"
            className="block text-sm font-medium mb-1.5"
          >
            Role archetype
            <RequiredMark />
          </label>
          <select
            id="archetype"
            value={archetype}
            onChange={(e) => setArchetype(e.target.value)}
            disabled={submitting}
            required
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            aria-describedby="archetype-hint"
          >
            <option value="" disabled>
              — pick a role —
            </option>
            {ARCHETYPES.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.displayName}
              </option>
            ))}
          </select>
          <p
            id="archetype-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            Selects which workspace-defaults overlay the agent boots
            with. Determines the tone, operating style, boundaries, and
            domain conventions written into <code>SOUL.md</code> and{' '}
            <code>AGENTS.md</code>. Pick <em>Custom</em> for a free-form
            persona with no role scaffold.
          </p>
        </div>

        {selectedArchetype && selectedArchetype.slug !== 'custom' && (
          <div
            className="mb-3 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs"
            data-testid="archetype-preview"
          >
            <div className="font-medium mb-0.5">
              {selectedArchetype.displayName}
            </div>
            <p className="text-muted-foreground">
              {selectedArchetype.description}
            </p>
          </div>
        )}

        {selectedArchetype && selectedArchetype.slug === 'custom' && (
          <div
            className="mb-3 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs"
            data-testid="archetype-preview"
          >
            <div className="font-medium mb-0.5">Custom (free-form)</div>
            <p className="text-muted-foreground">
              No role scaffold — the persona text below becomes the
              entire role definition. Required when this archetype is
              selected.
            </p>
          </div>
        )}
      </div>

      {/* Persona scaffolding. displayName is always optional (it sits
          alongside the archetype's role framing); persona is optional
          when an archetype is picked (layers above the archetype) and
          required when archetype = Custom (it IS the role). */}
      <div className="border-t pt-4 mt-2">
        <p className="text-xs text-muted-foreground mb-3">
          Persona scaffolding — these get hard-templated into the
          agent&apos;s <code>IDENTITY.md</code> and <code>SOUL.md</code>{' '}
          at boot.
          {personaRequired
            ? ' Persona is required for the Custom archetype.'
            : ' Persona is optional and layers above the archetype.'}
        </p>

        <div className="mb-3">
          <label
            htmlFor="displayName"
            className="block text-sm font-medium mb-1.5"
          >
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={submitting}
                        className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            placeholder='e.g. "Aria" or "Vendor Ops Bot"'
            aria-describedby="displayName-hint"
          />
          <p
            id="displayName-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            <span className={displayNameBytes > DISPLAY_NAME_MAX_BYTES ? 'text-destructive' : ''}>
              {displayNameBytes}/{DISPLAY_NAME_MAX_BYTES} bytes (UTF-8).
            </span>{' '}
            Human-readable name shown as the bot&apos;s display name in
            Slack. If left blank, the agent name is used instead. Also
            written to the agent&apos;s <code>IDENTITY.md</code> for
            self-reference.
          </p>
        </div>

        <div className="mb-1">
          <label
            htmlFor="persona"
            className="block text-sm font-medium mb-1.5"
          >
            Persona
            {personaRequired && <RequiredMark />}
          </label>
          <textarea
            id="persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            disabled={submitting}
            required={personaRequired}
                        rows={personaRequired ? 6 : 4}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            placeholder={
              personaRequired
                ? 'Describe the agent’s role, tone, boundaries, and operating style. This is the entire persona — no archetype scaffold.'
                : 'Direct, opinionated, resourceful. Skip filler. Disagree when warranted.'
            }
            aria-describedby="persona-hint"
          />
          <p
            id="persona-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            <span className={personaBytes > PERSONA_MAX_BYTES ? 'text-destructive' : ''}>
              {personaBytes}/{PERSONA_MAX_BYTES} bytes (UTF-8).
            </span>{' '}
            {personaRequired
              ? 'Required for Custom — this becomes the agent’s entire role definition. Tone, boundaries, domain expertise, interaction style.'
              : 'Optional personality and behavioral guidelines written to the agent’s SOUL.md as an Operator-Supplied Persona section layered above the archetype defaults.'}{' '}
            Markdown allowed; ATX headings (any <code>#</code> level)
            are stripped at boot time to prevent section-hijack.
          </p>
        </div>
      </div>

      {/* #376: Primary owner. Required fields — every agent has a human
          who is responsible for it. Lands in USER.md via init-config so
          the agent knows who its owner is on first boot. */}
      <div className="border-t pt-4 mt-2">
        <p className="text-xs text-muted-foreground mb-3">
          Primary owner — the human responsible for this agent. Lands in
          the agent&apos;s <code>USER.md</code> on first boot so the
          agent knows who to address as its owner.
        </p>

        <div className="mb-3">
          <label
            htmlFor="ownerName"
            className="block text-sm font-medium mb-1.5"
          >
            Owner name
            <RequiredMark />
          </label>
          <input
            id="ownerName"
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            disabled={submitting}
            required
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            placeholder='e.g. "Andrew Stroup"'
            aria-describedby="ownerName-hint"
          />
          <p
            id="ownerName-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            <span className={ownerNameBytes > OWNER_NAME_MAX_BYTES ? 'text-destructive' : ''}>
              {ownerNameBytes}/{OWNER_NAME_MAX_BYTES} bytes (UTF-8).
            </span>{' '}
            Lands in the <code>**Name:**</code> bullet of{' '}
            <code>USER.md</code>.
          </p>
        </div>

        <div className="mb-3">
          <label
            htmlFor="ownerSlackId"
            className="block text-sm font-medium mb-1.5"
          >
            Owner Slack ID
            <RequiredMark />
          </label>
          <input
            id="ownerSlackId"
            type="text"
            value={ownerSlackId}
            onChange={(e) => setOwnerSlackId(e.target.value)}
            disabled={submitting}
            required
            pattern="^U[A-Z0-9]{8,}$"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            placeholder="U01ABCDEF23"
            aria-describedby="ownerSlackId-hint"
          />
          <p
            id="ownerSlackId-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            Slack workspace user ID — starts with <code>U</code>{' '}
            followed by 8+ uppercase alphanumeric chars. Find via{' '}
            <em>Slack profile → More → Copy member ID</em>. Lands in{' '}
            <code>USER.md</code> as a <code>&lt;@U…&gt;</code> mention
            so the agent sees a clickable handle.
          </p>
        </div>

        <div className="mb-1">
          <label
            htmlFor="ownerTimezone"
            className="block text-sm font-medium mb-1.5"
          >
            Owner timezone
          </label>
          <input
            id="ownerTimezone"
            type="text"
            value={ownerTimezone}
            onChange={(e) => setOwnerTimezone(e.target.value)}
            disabled={submitting}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            placeholder="America/New_York"
            aria-describedby="ownerTimezone-hint"
          />
          <p
            id="ownerTimezone-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            <span className={ownerTimezoneBytes > OWNER_TZ_MAX_BYTES ? 'text-destructive' : ''}>
              {ownerTimezoneBytes}/{OWNER_TZ_MAX_BYTES} bytes (UTF-8).
            </span>{' '}
            IANA timezone name. Pre-filled from your browser; override
            if you&apos;re creating an agent for someone in a different
            zone. Lands in <code>USER.md</code> as the{' '}
            <code>**Timezone:**</code> bullet.
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={!formValid || submitting}>
          {submitting ? 'Creating…' : 'Create agent'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
