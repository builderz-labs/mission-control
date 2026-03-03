/**
 * Lionroot Usage Ledger — Shared Types
 *
 * Ported from Command Post dashboard/lib/types/usage-ledger.ts
 * with adaptations for Mission Control's runtime.
 *
 * These types are the contract between:
 *   - API route (GET /api/lionroot/usage-ledger)
 *   - Reader modules (lib/lionroot/usage/readers.ts)
 *   - Aggregation (lib/lionroot/usage/aggregation.ts)
 *   - UI panel (components/panels/lionroot/usage-ledger-panel.tsx)
 */

/* ── Service classification ── */

/** The CLI/service that originated the usage */
export type ServiceId =
  | 'claude-cli'
  | 'codex-cli'
  | 'gemini-cli'
  | 'cursor-cli'
  | 'ollama'
  | 'zulip-bot'
  | 'clawdbot'
  | 'cron'
  | 'other';

export const SERVICE_LABELS: Record<ServiceId, string> = {
  'claude-cli': 'Claude CLI',
  'codex-cli': 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  'cursor-cli': 'Cursor CLI',
  ollama: 'Ollama',
  'zulip-bot': 'Zulip Bot',
  clawdbot: 'ClawdBot',
  cron: 'Cron Jobs',
  other: 'Other',
};

export const SERVICE_COLORS: Record<ServiceId, string> = {
  'claude-cli': '#3b82f6',
  'codex-cli': '#10b981',
  'gemini-cli': '#f59e0b',
  'cursor-cli': '#8b5cf6',
  ollama: '#ef4444',
  'zulip-bot': '#06b6d4',
  clawdbot: '#ec4899',
  cron: '#6366f1',
  other: '#9ca3af',
};

/* ── Usage source (backwards-compat with existing entries) ── */

export type UsageSource = 'cron' | 'chat' | 'nightshift' | 'unknown';

/* ── Unified entry ── */

export type UnifiedEntry = {
  id: string;
  timestamp: string;
  source: UsageSource;
  service?: ServiceId;
  provider: string;
  model: string;
  backend: string; // normalized: claude | openai | codex | google | local | unknown
  jobName?: string;
  jobId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  status?: string;
  summary?: string;
  tier?: string;
  savings?: number;
  sessionId?: string;
  channel?: string;
  deduplicated?: boolean;
};

/* ── Daily aggregation ── */

export type DailyBucket = {
  date: string; // YYYY-MM-DD
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  byService: Record<ServiceId, { cost: number; tokens: number; requests: number }>;
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number; requests: number }>;
};

/* ── Session rollup ── */

export type SessionRollup = {
  sessionId: string;
  label: string;
  service: ServiceId;
  channel?: string;
  startedAt: string;
  lastActivityAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  toolCallCount: number;
  model?: string;
  provider?: string;
  models?: string[];
};

/* ── CodexBar snapshot ── */

export type CodexBarProviderCost = {
  provider: string;
  sessionTokens: number;
  sessionCostUSD: number;
  last30DaysTokens: number;
  last30DaysCostUSD: number;
  daily: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCost: number;
    modelsUsed: string[];
    modelBreakdowns: Array<{ modelName: string; cost: number }>;
  }>;
  totals?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCost: number;
  };
};

export type CodexBarUsageProvider = {
  provider: string;
  primary: { usedPercent: number; resetsAt: string; windowMinutes?: number };
  secondary?: { usedPercent: number; resetsAt: string; windowMinutes?: number };
};

export type CodexBarSnapshot = {
  collectedAt: string;
  hostname?: string;
  errors?: number;
  providers: CodexBarProviderCost[];
  usage?: CodexBarUsageProvider[];
};

/* ── Cost insights ── */

export type WasteIndicator = {
  type:
    | 'high-cost-low-output'
    | 'excessive-cache-miss'
    | 'idle-sessions'
    | 'retry-waste'
    | 'model-mismatch';
  description: string;
  estimatedWaste: number;
  affectedSessions?: string[];
};

export type CostInsights = {
  costPer1kTokens: Record<string, number>;
  topCostDrivers: Array<{ label: string; cost: number; pctOfTotal: number }>;
  cacheHitRate: number;
  cacheSavingsEstimate: number;
  wasteIndicators: WasteIndicator[];
  dailyTrend: Array<{ date: string; cost: number; avgCostPer1k: number }>;
  projectedMonthlyCost: number;
};

/* ── Service breakdown ── */

export type ServiceStats = {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  models: string[];
  avgCostPerRequest: number;
  sessionCount: number;
  dailySpark: number[];
};

/* ── API response ── */

export type LedgerResponse = {
  entries: UnifiedEntry[];
  total: number;
  summary: {
    bySource: Array<{
      source: UsageSource;
      count: number;
      totalCost: number;
      totalTokens: number;
    }>;
    byProvider: Array<{
      provider: string;
      backend: string;
      count: number;
      totalCost: number;
      totalTokens: number;
      models: string[];
    }>;
    cronJobs: Array<{
      jobId: string;
      jobName: string;
      runs: number;
      totalCost: number;
      totalTokens: number;
      lastModel: string;
      lastRun: string;
    }>;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
  };
  daily: DailyBucket[];
  sessions: SessionRollup[];
  codexbar: CodexBarSnapshot | null;
  byService: Record<ServiceId, ServiceStats>;
  insights: CostInsights;
};
