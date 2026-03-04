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
  'gemini-cli': 'Gemini CLI (AI Pro)',
  'cursor-cli': 'Cursor CLI',
  ollama: 'Ollama (local)',
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

/* ── Billing mode per service ── */

/**
 * How a service is billed:
 *   subscription — flat monthly fee (e.g. Claude Max $200/mo, ChatGPT Pro $200/mo)
 *   free         — no cost (self-hosted Ollama, Gemini free tier)
 *   api          — pay-per-token (API keys, cron jobs, bots)
 */
export type BillingMode = 'subscription' | 'free' | 'api';

export type ServiceBilling = {
  mode: BillingMode;
  planName?: string;       // e.g. "Claude Max", "ChatGPT Pro"
  monthlyCost?: number;    // flat fee in USD
};

/**
 * Default billing config per service.
 * Override via BILLING_CONFIG env var (JSON) if plans change.
 */
export const SERVICE_BILLING: Record<ServiceId, ServiceBilling> = {
  'claude-cli':  { mode: 'subscription', planName: 'Claude Max', monthlyCost: 200 },
  'codex-cli':   { mode: 'subscription', planName: 'ChatGPT Pro', monthlyCost: 200 },
  'gemini-cli':  { mode: 'subscription', planName: 'Google AI Pro', monthlyCost: 19.99 },
  'cursor-cli':  { mode: 'subscription', planName: 'Cursor Pro', monthlyCost: 20 },
  ollama:        { mode: 'free', planName: 'Self-hosted (local)' },
  'zulip-bot':   { mode: 'api' },
  clawdbot:      { mode: 'api' },
  cron:          { mode: 'api' },
  other:         { mode: 'api' },
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

export type SubscriptionSavings = {
  service: ServiceId;
  planName: string;
  monthlyCost: number;
  apiEquivalentCost: number;
  savings: number;          // apiEquivalent - monthlyCost (positive = saving money)
  savingsPercent: number;   // savings / apiEquivalent * 100
};

export type CostInsights = {
  costPer1kTokens: Record<string, number>;
  topCostDrivers: Array<{ label: string; cost: number; pctOfTotal: number }>;
  cacheHitRate: number;
  cacheSavingsEstimate: number;
  wasteIndicators: WasteIndicator[];
  dailyTrend: Array<{ date: string; cost: number; avgCostPer1k: number }>;
  projectedMonthlyCost: number;
  /** Per-service savings breakdown: subscription cost vs API-equivalent */
  subscriptionSavings: SubscriptionSavings[];
  /** Total saved across all subscriptions + local models */
  totalSavings: number;
};

/* ── Service breakdown ── */

export type ServiceStats = {
  totalCost: number;          // actual cost (subscription fee or API cost)
  apiEquivalentCost: number;  // what this would cost at API per-token rates
  totalTokens: number;
  totalRequests: number;
  models: string[];
  avgCostPerRequest: number;
  sessionCount: number;
  dailySpark: number[];
  billing: ServiceBilling;
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
