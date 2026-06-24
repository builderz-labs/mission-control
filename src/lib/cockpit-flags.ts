/**
 * Cockpit Phase-2 feature flags.
 *
 * Phase-1 cockpit panels (timeline / agent feed / tools) are always-on and
 * read-only. The Phase-2 ACTION panels (approvals, chat) are SCAFFOLD-ONLY and
 * default OFF. They register + render only when their flag is explicitly ON.
 *
 * The panels are client components and registration runs client-side, so the
 * flag must be inlined at build time — hence the `NEXT_PUBLIC_` prefix. Both the
 * documented name and its NEXT_PUBLIC_ variant are honoured; default is OFF.
 *
 *   COCKPIT_APPROVALS_ENABLED / NEXT_PUBLIC_COCKPIT_APPROVALS_ENABLED
 *   COCKPIT_CHAT_ENABLED      / NEXT_PUBLIC_COCKPIT_CHAT_ENABLED
 *
 * Truthy = '1' | 'true' | 'yes' | 'on' (case-insensitive). Anything else = OFF.
 */

function truthy(v: string | undefined): boolean {
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/** Phase-2 Approvals panel — scaffold, default OFF. */
export function cockpitApprovalsEnabled(): boolean {
  return (
    truthy(process.env.NEXT_PUBLIC_COCKPIT_APPROVALS_ENABLED) ||
    truthy(process.env.COCKPIT_APPROVALS_ENABLED)
  )
}

/** Phase-2 Chat panel — scaffold, must NOT deploy live; default OFF. */
export function cockpitChatEnabled(): boolean {
  return (
    truthy(process.env.NEXT_PUBLIC_COCKPIT_CHAT_ENABLED) ||
    truthy(process.env.COCKPIT_CHAT_ENABLED)
  )
}
