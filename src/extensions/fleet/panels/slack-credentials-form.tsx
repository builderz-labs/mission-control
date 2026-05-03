'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  SlackCredentialsResponse,
  SlackCredentialsErrorResponse,
} from '../api/slack-credentials'
// Import shared regex patterns rather than duplicate them.
// Round-3 audit on PR #51: server-side has been revised twice
// already (PR #48 rounds 1 + 6); duplicating here would silently
// drift on the next server-side update. Single source of truth.
import {
  APP_TOKEN_RE,
  BOT_TOKEN_RE,
  SIGNING_SECRET_RE,
} from '../lib/slack-token-patterns'

// Phase 2.4 Beat 5c.2 — Slack credentials paste form.
//
// Three masked inputs for the operator to paste the tokens
// extracted from api.slack.com/apps after creating an app from
// the Beat 5b.1 manifest:
//   - App-level token (xapp-...) — for Socket Mode WebSocket
//   - Bot User OAuth Token (xoxb-...) — for outbound API calls
//   - Signing secret — 32-char lowercase hex
//
// Mirrors server-side regexes from slack-credentials.ts so
// invalid pastes fail client-side without an AWS round-trip.
// The server is the source of truth — these regexes are
// belt-and-suspenders + UX (red border + inline error before
// the operator clicks Save). If they ever drift from the
// server, the server still rejects the request.
//
// On success: invokes onSaved with the response so the parent
// (AgentDetailPanel) can pivot to rendering the channel picker.
// Form stays mounted with a "Saved" success state so the
// operator can re-paste/rotate without re-opening the panel.

const SUBMIT_TIMEOUT_MS = 30_000

interface Props {
  agentName: string
  /**
   * Called after a successful 200 — parent should refresh the
   * channel picker. Round-1 audit on PR #51: simplified from
   * `(response: SlackCredentialsResponse) => void` since no
   * caller reads the response body. Server-confirmed success
   * is the only signal needed.
   */
  onSaved: () => void
}

type FormState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; response: SlackCredentialsResponse }
  | { kind: 'error'; status: number; body: SlackCredentialsErrorResponse }

interface FieldErrors {
  appToken?: string
  botToken?: string
  signingSecret?: string
}

export function SlackCredentialsForm({ agentName, onSaved }: Props) {
  // Token values — never logged, never stored in localStorage,
  // never sent anywhere except the POST body. Cleared on
  // successful submit (the response confirms SM ARNs; the
  // tokens themselves are now in Secrets Manager).
  const [appToken, setAppToken] = useState('')
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [state, setState] = useState<FormState>({ kind: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const abortRef = useRef<AbortController | null>(null)
  // Round-1 audit on PR #51: unmount guard so the in-flight POST's
  // catch block doesn't setState after the panel closes. React 18+
  // silently swallows stale-state-on-unmount, but matching the
  // SlackChannelPicker pattern (cleanupAborted flag) closes the
  // inconsistency.
  const mountedRef = useRef(true)

  // Reset transient state when the agent changes (panel switched
  // to a different row). Token fields stay private to this
  // session of the form for this agent.
  useEffect(() => {
    setAppToken('')
    setBotToken('')
    setSigningSecret('')
    setState({ kind: 'idle' })
    setFieldErrors({})
  }, [agentName])

  // Abort the in-flight POST on unmount + flip the mounted
  // guard so the catch block bails before setState.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const validateClientSide = (): FieldErrors => {
    const errs: FieldErrors = {}
    if (!APP_TOKEN_RE.test(appToken)) {
      errs.appToken = 'Expected xapp-1-... format.'
    }
    if (!BOT_TOKEN_RE.test(botToken)) {
      errs.botToken = 'Expected xoxb-... format.'
    }
    if (!SIGNING_SECRET_RE.test(signingSecret)) {
      errs.signingSecret = 'Expected exactly 32 lowercase hex chars.'
    }
    return errs
  }

  const submitting = state.kind === 'submitting'
  const allFilled =
    appToken.length > 0 && botToken.length > 0 && signingSecret.length > 0
  const submitDisabled = !allFilled || submitting

  const handleSubmit = async () => {
    const errs = validateClientSide()
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    setState({ kind: 'submitting' })
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)

    try {
      const resp = await fetch(
        `/api/fleet/agents/${encodeURIComponent(agentName)}/slack/credentials`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // No `channels` array yet — the channel picker (Beat
          // 5c.2 sibling component) writes that on its own
          // submit. First credential paste creates the secrets
          // with an empty channels list; channel-picker save
          // updates the OPENCLAW_SLACK_CONFIG_JSON env on the
          // task-def revision.
          body: JSON.stringify({ appToken, botToken, signingSecret }),
          signal: controller.signal,
        },
      )
      clearTimeout(timeout)

      if (resp.ok) {
        const body = (await resp.json()) as SlackCredentialsResponse
        if (!mountedRef.current) return
        // Clear the in-memory token values now that they're
        // safely in Secrets Manager. No reason to keep them
        // in React state past success.
        setAppToken('')
        setBotToken('')
        setSigningSecret('')
        setState({ kind: 'success', response: body })
        onSaved()
        return
      }

      let body: SlackCredentialsErrorResponse
      try {
        body = (await resp.json()) as SlackCredentialsErrorResponse
      } catch {
        body = { error: `HTTP ${resp.status}` }
      }
      if (!mountedRef.current) return
      // Map the server's `fieldErrors` (if present) to inline
      // field state so the operator sees which token failed.
      if (body.fieldErrors) {
        setFieldErrors(body.fieldErrors)
      }
      setState({ kind: 'error', status: resp.status, body })
    } catch (err) {
      clearTimeout(timeout)
      if (!mountedRef.current) return
      if (controller.signal.aborted) {
        setState({
          kind: 'error',
          status: 0,
          body: {
            error: 'RequestAborted',
            detail: 'Save request timed out or was cancelled',
          },
        })
        return
      }
      setState({
        kind: 'error',
        status: 0,
        body: {
          error: 'NetworkError',
          detail: (err as Error).message,
        },
      })
    }
  }

  if (state.kind === 'success') {
    return (
      <div data-testid="slack-credentials-success" className="space-y-2">
        <div className="text-sm text-green-700">
          ✓ Credentials saved. Pick channels below.
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setState({ kind: 'idle' })}
          data-testid="slack-credentials-rotate"
        >
          Rotate / re-paste credentials
        </Button>
      </div>
    )
  }

  return (
    <form
      data-testid="slack-credentials-form"
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      className="space-y-3"
    >
      <CredentialField
        id="slack-app-token"
        label="App-level token (xapp-…)"
        value={appToken}
        onChange={setAppToken}
        error={fieldErrors.appToken}
        disabled={submitting}
        testId="slack-credentials-app-token"
        placeholder="xapp-1-A12345…"
      />
      <CredentialField
        id="slack-bot-token"
        label="Bot User OAuth Token (xoxb-…)"
        value={botToken}
        onChange={setBotToken}
        error={fieldErrors.botToken}
        disabled={submitting}
        testId="slack-credentials-bot-token"
        placeholder="xoxb-12345-67890-…"
      />
      <CredentialField
        id="slack-signing-secret"
        label="Signing secret (32 hex chars)"
        value={signingSecret}
        onChange={setSigningSecret}
        error={fieldErrors.signingSecret}
        disabled={submitting}
        testId="slack-credentials-signing-secret"
        placeholder="abc123…"
      />

      {state.kind === 'error' ? (
        <div
          className="p-3 rounded-md bg-destructive/10 text-destructive text-sm"
          data-testid="slack-credentials-error"
        >
          <div className="font-semibold">
            {state.body.error}
            {state.status > 0 ? ` (HTTP ${state.status})` : ''}
          </div>
          {state.body.detail ? (
            <div className="mt-1">
              <code className="text-xs">{state.body.detail}</code>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitDisabled}
          data-testid="slack-credentials-submit"
        >
          {submitting ? 'Saving…' : 'Save credentials'}
        </Button>
      </div>
    </form>
  )
}

interface CredentialFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error: string | undefined
  disabled: boolean
  testId: string
  placeholder: string
}

function CredentialField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  testId,
  placeholder,
}: CredentialFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        // type="password" so the browser doesn't autofill,
        // doesn't echo to plaintext on screenshare, and the
        // browser's password-manager-suggestions don't kick in
        // (these aren't passwords). autoComplete="off" +
        // spellCheck=false suppress the native helpers entirely.
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        data-testid={testId}
        // Theme-aware tokens (bg-secondary / border-border) —
        // mirror create-agent-form / delete-agent-form so this
        // doesn't render as a white input on dark theme.
        className={`w-full h-10 px-3 rounded-lg bg-secondary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50 ${
          error ? 'border-2 border-destructive' : 'border border-border'
        }`}
      />
      {error ? (
        <div
          className="text-xs text-destructive mt-1"
          data-testid={`${testId}-error`}
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}
