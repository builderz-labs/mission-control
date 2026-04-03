/** Agent operational status */
export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline' | 'spawning' | 'stopping';

/** Tailwind background color class for a given agent status */
export const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-emerald-500',
  busy: 'bg-amber-500',
  error: 'bg-red-500',
  offline: 'bg-zinc-500',
  spawning: 'bg-blue-500',
  stopping: 'bg-orange-500',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  idle: 'text-emerald-400',
  busy: 'text-amber-400',
  error: 'text-red-400',
  offline: 'text-zinc-400',
  spawning: 'text-blue-400',
  stopping: 'text-orange-400',
};

/** Get Tailwind bg class for agent status, with fallback */
export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-zinc-500';
}

/** Get Tailwind text color class for agent status */
export function getStatusTextColor(status: string): string {
  return STATUS_TEXT_COLORS[status] ?? 'text-zinc-400';
}

/** Get human-readable label for agent status */
export function getStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
