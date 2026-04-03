// Shared date formatting utilities — eliminates duplication across 46+ panel files

function toDate(ts: number | string): Date {
  return typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
}

export function formatDate(ts: number | string | null | undefined): string {
  if (ts == null) return "";
  return toDate(ts).toLocaleDateString();
}

export function formatDateTime(ts: number | string | null | undefined): string {
  if (ts == null) return "";
  return toDate(ts).toLocaleString();
}

export function formatTime(ts: number | string | null | undefined): string {
  if (ts == null) return "";
  return toDate(ts).toLocaleTimeString();
}

export function formatRelativeTime(ts: number | string | null | undefined): string {
  if (ts == null) return "";
  const date = toDate(ts);
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 2592000) return `${Math.floor(diffSeconds / 86400)}d ago`;
  return formatDate(ts);
}
