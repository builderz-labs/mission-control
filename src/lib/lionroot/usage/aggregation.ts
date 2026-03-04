/**
 * Lionroot Usage Ledger — Aggregation & Insights
 *
 * Ported from Command Post dashboard/lib/usage/aggregation.ts
 */

import type {
  UnifiedEntry,
  UsageSource,
  ServiceId,
  DailyBucket,
  SessionRollup,
  CodexBarSnapshot,
  CostInsights,
  WasteIndicator,
  ServiceStats,
  ServiceBilling,
  SubscriptionSavings,
} from './types';
import { SERVICE_BILLING } from './types';
import { costPer1kTokens, estimateLocalModelApiCost } from './costs';
import type { ClaudeStatsDailyResult } from './readers';

/* ── All service IDs ── */

const ALL_SERVICES: ServiceId[] = [
  'claude-cli', 'codex-cli', 'gemini-cli', 'cursor-cli',
  'ollama', 'zulip-bot', 'clawdbot', 'cron', 'other',
];

/* ══════════════════════════════════════════════════════════
   Service Classification
   ══════════════════════════════════════════════════════════ */

export function classifyService(entry: UnifiedEntry): ServiceId {
  if (entry.service) return entry.service;
  if (entry.source === 'cron') return 'cron';

  const m = (entry.model || '').toLowerCase();
  const p = (entry.provider || '').toLowerCase();

  if (m.includes('claude') || p.includes('anthropic') || p.includes('claude')) return 'claude-cli';
  if (m.includes('gpt') || m.includes('o3') || m.includes('o1') || p.includes('codex') || p.includes('openai')) return 'codex-cli';
  if (m.includes('gemini') || p.includes('google') || p.includes('gemini')) return 'gemini-cli';
  if (p.includes('cursor')) return 'cursor-cli';
  if (p.includes('ollama') || m.includes('ollama')) return 'ollama';

  return 'other';
}

/* ══════════════════════════════════════════════════════════
   Summary Builder
   ══════════════════════════════════════════════════════════ */

type SourceSummary = { source: UsageSource; count: number; totalCost: number; totalTokens: number };
type ProviderSummary = { provider: string; backend: string; count: number; totalCost: number; totalTokens: number; models: string[] };
type CronJobSummary = { jobId: string; jobName: string; runs: number; totalCost: number; totalTokens: number; lastModel: string; lastRun: string };

export type LedgerSummary = {
  bySource: SourceSummary[];
  byProvider: ProviderSummary[];
  cronJobs: CronJobSummary[];
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
};

export function buildSummary(entries: UnifiedEntry[]): LedgerSummary {
  const bySourceMap = new Map<UsageSource, SourceSummary>();
  const byProviderMap = new Map<string, ProviderSummary>();
  const cronJobMap = new Map<string, CronJobSummary>();
  let totalCost = 0;
  let totalTokens = 0;

  for (const e of entries) {
    // by source
    const src = bySourceMap.get(e.source) || { source: e.source, count: 0, totalCost: 0, totalTokens: 0 };
    src.count++;
    src.totalCost += e.cost ?? 0;
    src.totalTokens += e.totalTokens ?? 0;
    bySourceMap.set(e.source, src);

    // by provider
    const pKey = e.provider || 'unknown';
    const prov = byProviderMap.get(pKey) || { provider: pKey, backend: e.backend, count: 0, totalCost: 0, totalTokens: 0, models: [] };
    prov.count++;
    prov.totalCost += e.cost ?? 0;
    prov.totalTokens += e.totalTokens ?? 0;
    if (e.model && !prov.models.includes(e.model)) prov.models.push(e.model);
    byProviderMap.set(pKey, prov);

    // cron jobs
    if (e.source === 'cron' && e.jobId) {
      const cj = cronJobMap.get(e.jobId) || { jobId: e.jobId, jobName: e.jobName || e.jobId, runs: 0, totalCost: 0, totalTokens: 0, lastModel: 'unknown', lastRun: '' };
      cj.runs++;
      cj.totalCost += e.cost ?? 0;
      cj.totalTokens += e.totalTokens ?? 0;
      if (e.model && e.model !== 'unknown') cj.lastModel = e.model;
      if (e.timestamp > cj.lastRun) cj.lastRun = e.timestamp;
      cronJobMap.set(e.jobId, cj);
    }

    totalCost += e.cost ?? 0;
    totalTokens += e.totalTokens ?? 0;
  }

  return {
    bySource: Array.from(bySourceMap.values()).sort((a, b) => b.count - a.count),
    byProvider: Array.from(byProviderMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    cronJobs: Array.from(cronJobMap.values()).sort((a, b) => b.runs - a.runs),
    totalCost,
    totalTokens,
    totalRequests: entries.length,
  };
}

/* ══════════════════════════════════════════════════════════
   Daily Bucket Aggregation
   ══════════════════════════════════════════════════════════ */

const EMPTY_SERVICE_STATS = (): Record<ServiceId, { cost: number; tokens: number; requests: number }> => ({
  'claude-cli': { cost: 0, tokens: 0, requests: 0 },
  'codex-cli': { cost: 0, tokens: 0, requests: 0 },
  'gemini-cli': { cost: 0, tokens: 0, requests: 0 },
  'cursor-cli': { cost: 0, tokens: 0, requests: 0 },
  ollama: { cost: 0, tokens: 0, requests: 0 },
  'zulip-bot': { cost: 0, tokens: 0, requests: 0 },
  clawdbot: { cost: 0, tokens: 0, requests: 0 },
  cron: { cost: 0, tokens: 0, requests: 0 },
  other: { cost: 0, tokens: 0, requests: 0 },
});

export function buildDailyBuckets(
  entries: UnifiedEntry[],
  codexbar: CodexBarSnapshot | null,
  claudeDaily: DailyBucket[],
): DailyBucket[] {
  const bucketMap = new Map<string, DailyBucket>();

  // Seed from Claude stats-cache (authoritative for claude-cli)
  for (const cb of claudeDaily) {
    bucketMap.set(cb.date, { ...cb });
  }

  for (const e of entries) {
    if (e.id.startsWith('claude-stats-')) continue;

    const date = e.timestamp.slice(0, 10);
    if (!date || date.length !== 10) continue;

    const bucket = bucketMap.get(date) || {
      date,
      totalCost: 0, totalTokens: 0, totalRequests: 0,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      byService: EMPTY_SERVICE_STATS(), byProvider: {}, byModel: [],
    };

    const cost = e.cost ?? 0;
    const tokens = e.totalTokens ?? 0;
    const service = e.service || classifyService(e);

    bucket.totalCost += cost;
    bucket.totalTokens += tokens;
    bucket.totalRequests += 1;
    bucket.inputTokens += e.inputTokens ?? 0;
    bucket.outputTokens += e.outputTokens ?? 0;
    bucket.cacheReadTokens += e.cacheReadTokens ?? 0;

    if (!bucket.byService[service]) bucket.byService[service] = { cost: 0, tokens: 0, requests: 0 };
    bucket.byService[service].cost += cost;
    bucket.byService[service].tokens += tokens;
    bucket.byService[service].requests += 1;

    const pKey = e.provider || 'unknown';
    if (!bucket.byProvider[pKey]) bucket.byProvider[pKey] = { cost: 0, tokens: 0, requests: 0 };
    bucket.byProvider[pKey].cost += cost;
    bucket.byProvider[pKey].tokens += tokens;
    bucket.byProvider[pKey].requests += 1;

    if (e.model && e.model !== 'unknown') {
      const existing = bucket.byModel.find((m) => m.model === e.model);
      if (existing) {
        existing.cost += cost; existing.tokens += tokens; existing.requests += 1;
      } else {
        bucket.byModel.push({ model: e.model, cost, tokens, requests: 1 });
      }
    }

    bucketMap.set(date, bucket);
  }

  // Merge CodexBar authoritative daily cost data
  if (codexbar) {
    for (const provider of codexbar.providers) {
      for (const day of provider.daily) {
        if (!day.date) continue;
        const bucket = bucketMap.get(day.date);
        if (!bucket) continue;
        for (const mb of day.modelBreakdowns) {
          const existing = bucket.byModel.find((m) => m.model === mb.modelName);
          if (existing) {
            existing.cost = Math.max(existing.cost, mb.cost);
          } else {
            bucket.byModel.push({ model: mb.modelName, cost: mb.cost, tokens: 0, requests: 0 });
          }
        }
      }
    }
  }

  return Array.from(bucketMap.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
}

/* ══════════════════════════════════════════════════════════
   Service Breakdown
   ══════════════════════════════════════════════════════════ */

export function buildServiceBreakdown(
  entries: UnifiedEntry[],
  sessions: SessionRollup[],
): Record<ServiceId, ServiceStats> {
  const stats: Record<ServiceId, ServiceStats> = {} as Record<ServiceId, ServiceStats>;
  for (const s of ALL_SERVICES) {
    const billing = SERVICE_BILLING[s];
    stats[s] = {
      totalCost: 0, apiEquivalentCost: 0,
      totalTokens: 0, totalRequests: 0, models: [],
      avgCostPerRequest: 0, sessionCount: 0, dailySpark: [],
      billing,
    };
  }

  for (const e of entries) {
    const service = e.service || classifyService(e);
    const s = stats[service];
    // Always accumulate API-equivalent cost (what per-token pricing would be)
    s.apiEquivalentCost += e.cost ?? 0;
    s.totalTokens += e.totalTokens ?? 0;
    s.totalRequests += 1;
    if (e.model && e.model !== 'unknown' && !s.models.includes(e.model)) s.models.push(e.model);
  }

  for (const sess of sessions) {
    const s = stats[sess.service];
    s.sessionCount += 1;
    if (sess.sessionId.startsWith('openclaw-')) {
      s.apiEquivalentCost += sess.totalCost;
      s.totalTokens += sess.totalTokens;
      s.totalRequests += sess.messageCount;
    }
    if (sess.model && !s.models.includes(sess.model)) s.models.push(sess.model);
  }

  // Set actual cost based on billing mode
  for (const [serviceId, s] of Object.entries(stats) as [ServiceId, ServiceStats][]) {
    const billing = SERVICE_BILLING[serviceId];
    if (billing.mode === 'subscription' && billing.monthlyCost != null) {
      // Flat monthly subscription — actual cost is the plan price, not per-token
      s.totalCost = billing.monthlyCost;
    } else if (billing.mode === 'free') {
      // Free / self-hosted — no cost
      s.totalCost = 0;
    } else {
      // API billing — actual cost equals the per-token calculated cost
      s.totalCost = s.apiEquivalentCost;
    }
    s.avgCostPerRequest = s.totalRequests > 0 ? s.totalCost / s.totalRequests : 0;
  }

  // 7-day sparkline
  const now = new Date();
  for (const service of ALL_SERVICES) {
    const spark: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      let dayCost = 0;
      for (const e of entries) {
        if (e.timestamp.slice(0, 10) === dateStr) {
          const svc = e.service || classifyService(e);
          if (svc === service) dayCost += e.cost ?? 0;
        }
      }
      spark.push(dayCost);
    }
    stats[service].dailySpark = spark;
  }

  return stats;
}

/* ══════════════════════════════════════════════════════════
   Cost Insights
   ══════════════════════════════════════════════════════════ */

export function buildCostInsights(
  entries: UnifiedEntry[],
  sessions: SessionRollup[],
  codexbar: CodexBarSnapshot | null,
): CostInsights {
  const subscriptionSavings = calculateSubscriptionSavings(entries, sessions);
  const totalSavings = subscriptionSavings.reduce((sum, s) => sum + Math.max(0, s.savings), 0);

  return {
    costPer1kTokens: calculateCostPer1k(entries),
    topCostDrivers: findTopCostDrivers(entries, sessions),
    cacheHitRate: calculateCacheHitRate(entries, sessions),
    cacheSavingsEstimate: estimateCacheSavings(sessions),
    wasteIndicators: detectWaste(entries, sessions),
    dailyTrend: buildDailyTrend(entries),
    projectedMonthlyCost: projectMonthlyCost(entries, codexbar),
    subscriptionSavings,
    totalSavings,
  };
}

/**
 * Calculate per-service savings: what you pay (subscription) vs what API rates would cost.
 * For free/local services (Ollama), savings = full API-equivalent cost.
 */
function calculateSubscriptionSavings(
  entries: UnifiedEntry[],
  sessions: SessionRollup[],
): SubscriptionSavings[] {
  const savings: SubscriptionSavings[] = [];

  // Accumulate API-equivalent cost per service
  const apiCostByService = new Map<ServiceId, number>();
  for (const e of entries) {
    const svc = e.service || classifyService(e);
    apiCostByService.set(svc, (apiCostByService.get(svc) || 0) + (e.cost ?? 0));
  }
  for (const s of sessions) {
    if (s.sessionId.startsWith('openclaw-')) {
      apiCostByService.set(s.service, (apiCostByService.get(s.service) || 0) + s.totalCost);
    }
  }

  // For Ollama: estimate API-equivalent from token counts using comparable models
  const ollamaEntries = entries.filter(e => (e.service || classifyService(e)) === 'ollama');
  if (ollamaEntries.length > 0) {
    let ollamaApiEquiv = 0;
    for (const e of ollamaEntries) {
      ollamaApiEquiv += estimateLocalModelApiCost(
        e.model || 'default',
        e.inputTokens ?? 0,
        e.outputTokens ?? 0,
      );
    }
    apiCostByService.set('ollama', ollamaApiEquiv);
  }

  for (const [serviceId, billing] of Object.entries(SERVICE_BILLING) as [ServiceId, ServiceBilling][]) {
    const apiEquiv = apiCostByService.get(serviceId) || 0;

    if (billing.mode === 'subscription' && billing.monthlyCost != null && apiEquiv > 0) {
      const saved = apiEquiv - billing.monthlyCost;
      savings.push({
        service: serviceId,
        planName: billing.planName || serviceId,
        monthlyCost: billing.monthlyCost,
        apiEquivalentCost: apiEquiv,
        savings: saved,
        savingsPercent: apiEquiv > 0 ? (saved / apiEquiv) * 100 : 0,
      });
    } else if (billing.mode === 'free' && apiEquiv > 0) {
      savings.push({
        service: serviceId,
        planName: billing.planName || serviceId,
        monthlyCost: 0,
        apiEquivalentCost: apiEquiv,
        savings: apiEquiv,
        savingsPercent: 100,
      });
    }
  }

  return savings.sort((a, b) => b.savings - a.savings);
}

function calculateCostPer1k(entries: UnifiedEntry[]): Record<string, number> {
  const byModel = new Map<string, { cost: number; tokens: number }>();
  for (const e of entries) {
    if (!e.model || e.model === 'unknown') continue;
    const existing = byModel.get(e.model) || { cost: 0, tokens: 0 };
    existing.cost += e.cost ?? 0;
    existing.tokens += e.totalTokens ?? 0;
    byModel.set(e.model, existing);
  }
  const result: Record<string, number> = {};
  for (const [model, data] of byModel) {
    result[model] = data.tokens > 0 ? (data.cost / data.tokens) * 1000 : costPer1kTokens(model);
  }
  return result;
}

function findTopCostDrivers(
  entries: UnifiedEntry[],
  sessions: SessionRollup[],
): Array<{ label: string; cost: number; pctOfTotal: number }> {
  const byLabel = new Map<string, number>();
  for (const e of entries) {
    const label = e.model && e.model !== 'unknown' ? e.model : e.provider || 'unknown';
    byLabel.set(label, (byLabel.get(label) || 0) + (e.cost ?? 0));
  }
  for (const s of sessions) {
    if (s.sessionId.startsWith('openclaw-') && s.model) {
      byLabel.set(s.model, (byLabel.get(s.model) || 0) + s.totalCost);
    }
  }
  const totalCost = Array.from(byLabel.values()).reduce((a, b) => a + b, 0);
  return Array.from(byLabel.entries())
    .map(([label, cost]) => ({ label, cost, pctOfTotal: totalCost > 0 ? (cost / totalCost) * 100 : 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
}

function calculateCacheHitRate(entries: UnifiedEntry[], sessions: SessionRollup[]): number {
  let totalCacheRead = 0, totalInput = 0;
  for (const e of entries) { totalCacheRead += e.cacheReadTokens ?? 0; totalInput += e.inputTokens ?? 0; }
  for (const s of sessions) { totalCacheRead += s.cacheReadTokens; totalInput += s.inputTokens; }
  const denominator = totalCacheRead + totalInput;
  return denominator > 0 ? totalCacheRead / denominator : 0;
}

function estimateCacheSavings(sessions: SessionRollup[]): number {
  let savings = 0;
  for (const s of sessions) {
    if (s.cacheReadTokens > 0 && s.model) {
      savings += costPer1kTokens(s.model) * (s.cacheReadTokens / 1000) * 0.9;
    }
  }
  return savings;
}

function detectWaste(entries: UnifiedEntry[], sessions: SessionRollup[]): WasteIndicator[] {
  const indicators: WasteIndicator[] = [];

  const highCostLow = sessions.filter((s) => s.totalCost > 1 && s.outputTokens < 100);
  if (highCostLow.length > 0) {
    indicators.push({
      type: 'high-cost-low-output',
      description: `${highCostLow.length} session(s) with cost >$1 but <100 output tokens`,
      estimatedWaste: highCostLow.reduce((a, s) => a + s.totalCost, 0),
      affectedSessions: highCostLow.map((s) => s.sessionId),
    });
  }

  const cacheMiss = sessions.filter((s) => s.inputTokens > 50000 && s.cacheReadTokens < s.inputTokens * 0.1);
  if (cacheMiss.length > 0) {
    const potentialSavings = cacheMiss.reduce((a, s) => {
      const saveable = s.inputTokens * 0.7;
      return a + (s.model ? costPer1kTokens(s.model) * (saveable / 1000) * 0.9 : 0);
    }, 0);
    indicators.push({
      type: 'excessive-cache-miss',
      description: `${cacheMiss.length} session(s) with >50k input but <10% cache hits`,
      estimatedWaste: potentialSavings,
      affectedSessions: cacheMiss.map((s) => s.sessionId),
    });
  }

  const idle = sessions.filter((s) => s.durationMs > 2 * 60 * 60 * 1000 && s.messageCount < 5);
  if (idle.length > 0) {
    indicators.push({
      type: 'idle-sessions',
      description: `${idle.length} session(s) open >2h with <5 messages`,
      estimatedWaste: 0,
      affectedSessions: idle.map((s) => s.sessionId),
    });
  }

  return indicators;
}

function buildDailyTrend(entries: UnifiedEntry[]): Array<{ date: string; cost: number; avgCostPer1k: number }> {
  const byDate = new Map<string, { cost: number; tokens: number }>();
  for (const e of entries) {
    const date = e.timestamp.slice(0, 10);
    if (!date || date.length !== 10) continue;
    const existing = byDate.get(date) || { cost: 0, tokens: 0 };
    existing.cost += e.cost ?? 0;
    existing.tokens += e.totalTokens ?? 0;
    byDate.set(date, existing);
  }
  return Array.from(byDate.entries())
    .map(([date, data]) => ({ date, cost: data.cost, avgCostPer1k: data.tokens > 0 ? (data.cost / data.tokens) * 1000 : 0 }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
}

function projectMonthlyCost(entries: UnifiedEntry[], codexbar: CodexBarSnapshot | null): number {
  // Sum up fixed subscription costs
  let subscriptionTotal = 0;
  const subscriptionServices = new Set<ServiceId>();
  for (const [serviceId, billing] of Object.entries(SERVICE_BILLING) as [ServiceId, ServiceBilling][]) {
    if (billing.mode === 'subscription' && billing.monthlyCost) {
      // Only count if the service was actually used this period
      const hasUsage = entries.some(e => (e.service || classifyService(e)) === serviceId);
      if (hasUsage) {
        subscriptionTotal += billing.monthlyCost;
        subscriptionServices.add(serviceId);
      }
    }
  }

  // For API-billed services, project from recent usage
  let apiProjected = 0;
  if (codexbar && codexbar.providers.length > 0) {
    let total30d = 0;
    for (const p of codexbar.providers) total30d += p.last30DaysCostUSD;
    if (total30d > 0) apiProjected = total30d;
  } else {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();
    let weekCost = 0;
    for (const e of entries) {
      const svc = e.service || classifyService(e);
      // Only include API-billed entries in the projection
      if (!subscriptionServices.has(svc) && SERVICE_BILLING[svc]?.mode === 'api') {
        if (e.timestamp >= cutoff) weekCost += e.cost ?? 0;
      }
    }
    apiProjected = (weekCost / 7) * 30;
  }

  return subscriptionTotal + apiProjected;
}

/* ══════════════════════════════════════════════════════════
   Deduplication
   ══════════════════════════════════════════════════════════ */

export function deduplicateEntries(entries: UnifiedEntry[]): UnifiedEntry[] {
  const WINDOW_MS = 2000;
  const TOKEN_TOLERANCE = 0.05;

  const crIndex = new Map<string, UnifiedEntry>();
  for (const e of entries.filter((e) => e.id.startsWith('cr-'))) {
    const key = `${e.model}-${Math.round(new Date(e.timestamp).getTime() / WINDOW_MS)}`;
    crIndex.set(key, e);
  }

  return entries.map((e) => {
    if (!e.id.startsWith('tt-')) return e;
    const key = `${e.model}-${Math.round(new Date(e.timestamp).getTime() / WINDOW_MS)}`;
    const crMatch = crIndex.get(key);
    if (crMatch && e.totalTokens && crMatch.totalTokens) {
      const diff = Math.abs(e.totalTokens - crMatch.totalTokens) / Math.max(e.totalTokens, 1);
      if (diff <= TOKEN_TOLERANCE) return { ...e, deduplicated: true };
    }
    return e;
  });
}
