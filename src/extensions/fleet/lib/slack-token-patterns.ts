/**
 * Shared Slack token regex patterns — Phase 2.4 Beat 5c.2.
 *
 * Single source of truth for the three Slack credential
 * shapes. Imported by both the server-side validator
 * (slack-credentials.ts) and the client-side form
 * (slack-credentials-form.tsx) to eliminate silent drift
 * between the two.
 *
 * Round-3 audit on PR #51 flagged the maintenance liability:
 * slack-credentials.ts had revised these regexes at least
 * twice in PR #48's audit history; client-side copies would
 * silently get stale on the next revision.
 *
 * Conventions documented inline so a future revision can
 * verify the constraint before relaxing or tightening.
 */

/**
 * App-level token (xapp-...) — used for the Socket Mode
 * WebSocket handshake.
 *
 * Round-1 audit on PR #48: middle segment widened to
 * `[A-Za-z0-9]+` (mixed case) since some Slack workspaces
 * surface upper/lower-case app IDs.
 */
export const APP_TOKEN_RE = /^xapp-1-[A-Za-z0-9]+-[0-9]+-[a-zA-Z0-9]+$/

/**
 * Bot User OAuth Token (xoxb-...) — used for outbound API
 * calls (conversations.list, chat.postMessage, etc.).
 *
 * Round-6 audit on PR #48: trailing `-` is intentionally
 * permitted (`xoxb-…-trailing-` matches). Slack's published
 * token format isn't stable; over-tightening would lock
 * out valid future formats. The IAM + Slack-side rejection
 * paths handle malformed values that slip through.
 */
export const BOT_TOKEN_RE = /^xoxb-[0-9]+-[0-9]+-[A-Za-z0-9-]+$/

/**
 * Signing secret — used by the agent for inbound webhook
 * signature verification.
 *
 * Round-1 audit on PR #48 narrowed this from {32,64} to
 * exactly {32} per Slack's current spec; the wider range
 * was a misread of historical docs.
 */
export const SIGNING_SECRET_RE = /^[a-f0-9]{32}$/
