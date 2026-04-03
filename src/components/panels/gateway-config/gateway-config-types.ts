// Shared types and constants for the gateway-config feature

export type FormMode = 'form' | 'json'

export type Feedback = { ok: boolean; text: string } | null

export type DiffEntry = { path: string; from: unknown; to: unknown }

/** Maps top-level config section keys to display metadata */
export const SECTION_META: Record<string, { label: string; icon: string }> = {
  gateway: { label: 'Gateway', icon: 'G' },
  agents: { label: 'Agents', icon: 'A' },
  channels: { label: 'Channels', icon: 'C' },
  auth: { label: 'Authentication', icon: 'K' },
  tools: { label: 'Tools', icon: 'T' },
  skills: { label: 'Skills', icon: 'S' },
  hooks: { label: 'Hooks', icon: 'H' },
  commands: { label: 'Commands', icon: '>' },
  messages: { label: 'Messages', icon: 'M' },
  models: { label: 'Models', icon: 'D' },
  env: { label: 'Environment', icon: 'E' },
  update: { label: 'Updates', icon: 'U' },
  logging: { label: 'Logging', icon: 'L' },
  browser: { label: 'Browser', icon: 'B' },
  session: { label: 'Session', icon: 'P' },
  cron: { label: 'Cron', icon: 'R' },
  web: { label: 'Web', icon: 'W' },
  ui: { label: 'UI', icon: 'I' },
  broadcast: { label: 'Broadcast', icon: 'N' },
  plugins: { label: 'Plugins', icon: 'X' },
  wizard: { label: 'Setup Wizard', icon: 'Z' },
  meta: { label: 'Metadata', icon: 'F' },
}

export const TAG_PRESETS = ['security', 'auth', 'network', 'performance', 'advanced'] as const
