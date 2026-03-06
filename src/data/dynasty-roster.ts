/**
 * Dynasty Agent Roster — canonical source of truth for agent identities.
 * Status is determined at runtime by querying the OpenClaw sessions store.
 */
export const DYNASTY_ROSTER = [
  { name: 'Cleon', role: 'Emperor / Strategy', emoji: '👑', model: 'opus' },
  { name: 'Mickey17', role: 'Daily Ops', emoji: '🐭', model: 'sonnet' },
  { name: 'Forge', role: 'Developer', emoji: '🔨', model: 'sonnet' },
  { name: 'Raven', role: 'Email Ops', emoji: '🐦‍⬛', model: 'kimi-k2.5' },
  { name: 'Whisper', role: 'Research & Intel', emoji: '🔍', model: 'kimi-k2.5' },
  { name: 'Kimi', role: 'Design & UI', emoji: '🎨', model: 'kimi-k2.5' },
  { name: 'Sentinel', role: 'Ops & Admin', emoji: '🛡️', model: 'kimi-k2.5' },
  { name: 'Lord Varys', role: 'Email Domain Lead', emoji: '🕷️', model: 'sonnet' },
  { name: 'Demerzel', role: 'Dev Intelligence', emoji: '🤖', model: 'sonnet' },
] as const

export type DynastyAgent = (typeof DYNASTY_ROSTER)[number]
