/**
 * Lionroot Usage Ledger — Multi-source Readers
 *
 * Each reader scans a specific CLI data directory and returns normalized
 * UnifiedEntry[] and/or SessionRollup[]. All readers are fail-safe:
 * if a data source is unavailable, they return empty arrays.
 *
 * Ported from Command Post dashboard/lib/usage/readers.ts with:
 *   - NEW: readGeminiSessionEntries()  — ~/.gemini/tmp/{proj}/chats/{sess}.json
 *   - NEW: readOllamaEntries()         — Ollama API /api/ps history
 *   - Adapted paths for MC config.ts
 *
 * Environment variables (set in docker-compose or .env):
 *   CODEXBAR_DATA_DIR   — CodexBar collected data
 *   CLAUDE_DATA_DIR     — ~/.claude override
 *   CODEX_DATA_DIR      — ~/.codex override
 *   GEMINI_DATA_DIR     — ~/.gemini override (Gemini CLI sessions)
 *   OLLAMA_HOST         — Ollama API endpoint (default http://localhost:11434)
 *   OPENCLAW_SESSIONS_DIR — gateway session JSONL files
 *   CRON_RUNS_DIR       — cron run logs
 *   CRON_PATH           — cron jobs.json
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { config } from '@/lib/config';
import type {
  UnifiedEntry,
  UsageSource,
  SessionRollup,
  CodexBarSnapshot,
  CodexBarProviderCost,
  CodexBarUsageProvider,
  DailyBucket,
  ServiceId,
} from './types';
import { estimateCost } from './costs';

/* ── Environment / Paths ── */

const HOME = process.env.HOME || homedir();

const CRON_PATH =
  process.env.CRON_PATH ||
  (config.openclawHome
    ? join(config.openclawHome, 'cron', 'jobs.json')
    : join(HOME, '.openclaw', 'cron', 'jobs.json'));

const CRON_RUNS_DIR =
  process.env.CRON_RUNS_DIR ||
  (config.openclawHome
    ? join(config.openclawHome, 'cron', 'runs')
    : join(HOME, '.openclaw', 'cron', 'runs'));

const CODEXBAR_DATA_DIR = process.env.CODEXBAR_DATA_DIR || '';
const CLAUDE_DATA_DIR = process.env.CLAUDE_DATA_DIR || config.claudeHome || join(HOME, '.claude');
const CODEX_DATA_DIR = process.env.CODEX_DATA_DIR || join(HOME, '.codex');
const GEMINI_DATA_DIR = process.env.GEMINI_DATA_DIR || join(HOME, '.gemini');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OPENCLAW_SESSIONS_DIR =
  process.env.OPENCLAW_SESSIONS_DIR ||
  (config.openclawHome ? join(config.openclawHome, 'sessions') : '');

/* ── Helpers ── */

function normalizeBackend(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('claude') || p.includes('anthropic')) return 'claude';
  if (p.includes('openai') || p.includes('gpt') || p.includes('o3') || p.includes('o1')) return 'openai';
  if (p.includes('codex')) return 'codex';
  if (p.includes('gemini') || p.includes('google')) return 'google';
  if (p.includes('local') || p.includes('exo') || p.includes('ollama')) return 'local';
  return 'unknown';
}

async function safeReadDir(dir: string): Promise<string[]> {
  if (!dir) return [];
  try {
    return await readdir(resolve(dir));
  } catch {
    return [];
  }
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(resolve(path), 'utf-8');
  } catch {
    return null;
  }
}

async function safeReadJson<T>(path: string): Promise<T | null> {
  const raw = await safeReadFile(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   1. Job Map (shared by cron reader)
   ══════════════════════════════════════════════════════════ */

export type JobMeta = {
  name: string;
  model: string;
  domain: string;
  sessionTarget: string;
};

export async function loadJobMap(): Promise<Map<string, JobMeta>> {
  const map = new Map<string, JobMeta>();
  try {
    const raw = await readFile(resolve(CRON_PATH), 'utf-8');
    const parsed = JSON.parse(raw) as {
      jobs: Array<{
        id: string;
        name: string;
        sessionTarget?: string;
        payload?: { model?: string };
      }>;
    };
    for (const j of parsed.jobs) {
      map.set(j.id, {
        name: j.name,
        model: j.payload?.model || 'default',
        domain: j.sessionTarget || 'main',
        sessionTarget: j.sessionTarget || 'main',
      });
    }
  } catch {
    // jobs.json not available
  }
  return map;
}

/* ══════════════════════════════════════════════════════════
   2. Cron Run-Logs
   ══════════════════════════════════════════════════════════ */

export async function readCronEntries(
  jobMap: Map<string, JobMeta>,
): Promise<UnifiedEntry[]> {
  const entries: UnifiedEntry[] = [];
  const files = await safeReadDir(CRON_RUNS_DIR);

  for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
    const jobId = file.replace('.jsonl', '');
    const meta = jobMap.get(jobId);
    const raw = await safeReadFile(join(resolve(CRON_RUNS_DIR), file));
    if (!raw) continue;

    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.action !== 'finished') continue;

        const ts = typeof obj.ts === 'number' ? obj.ts : 0;
        const usage = (obj.usage && typeof obj.usage === 'object' ? obj.usage : {}) as Record<string, number | undefined>;
        const rawProvider = typeof obj.provider === 'string' ? obj.provider : '';
        const rawModel = typeof obj.model === 'string' ? obj.model : '';
        const provider = rawProvider || (meta?.model !== 'default' ? 'inferred' : 'unknown');
        const model = rawModel || meta?.model || 'unknown';
        const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
        const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
        const totalTokens =
          typeof usage.total_tokens === 'number'
            ? usage.total_tokens
            : inputTokens !== undefined && outputTokens !== undefined
              ? inputTokens + outputTokens
              : undefined;

        entries.push({
          id: `cron-${jobId}-${ts}`,
          timestamp: new Date(ts).toISOString(),
          source: 'cron',
          service: 'cron',
          provider,
          model,
          backend: rawProvider ? normalizeBackend(rawProvider) : normalizeBackend(model),
          jobName: meta?.name || jobId,
          jobId,
          inputTokens,
          outputTokens,
          totalTokens,
          durationMs: typeof obj.durationMs === 'number' ? obj.durationMs : undefined,
          status: typeof obj.status === 'string' ? obj.status : undefined,
          summary:
            typeof obj.summary === 'string' && obj.summary.length > 0
              ? obj.summary.length > 200
                ? obj.summary.slice(0, 197) + '...'
                : obj.summary
              : undefined,
        });
      } catch {
        // skip bad lines
      }
    }
  }
  return entries;
}

/* ══════════════════════════════════════════════════════════
   3. Claude Stats-Cache
   ══════════════════════════════════════════════════════════ */

type ClaudeStatsCache = {
  version?: number;
  dailyActivity?: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens?: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
};

export type ClaudeStatsDailyResult = {
  daily: DailyBucket[];
  entries: UnifiedEntry[];
};

export async function readClaudeStatsCache(): Promise<ClaudeStatsDailyResult> {
  const empty: ClaudeStatsDailyResult = { daily: [], entries: [] };
  if (!CLAUDE_DATA_DIR) return empty;

  const stats = await safeReadJson<ClaudeStatsCache>(
    join(CLAUDE_DATA_DIR, 'stats-cache.json'),
  );
  if (!stats) return empty;

  const entries: UnifiedEntry[] = [];
  const dailyMap = new Map<string, DailyBucket>();

  const activityByDate = new Map<string, { messages: number; sessions: number; tools: number }>();
  for (const a of stats.dailyActivity || []) {
    activityByDate.set(a.date, {
      messages: a.messageCount,
      sessions: a.sessionCount,
      tools: a.toolCallCount,
    });
  }

  const emptyServiceStats = (): Record<ServiceId, { cost: number; tokens: number; requests: number }> => ({
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

  for (const dayEntry of stats.dailyModelTokens || []) {
    const date = dayEntry.date;
    if (!date || !dayEntry.tokensByModel) continue;

    let dayTotalTokens = 0;
    let dayTotalCost = 0;
    let dayRequests = 0;
    const byModel: Array<{ model: string; cost: number; tokens: number; requests: number }> = [];

    for (const [model, tokens] of Object.entries(dayEntry.tokensByModel)) {
      if (tokens <= 0) continue;
      const inputEst = Math.round(tokens * 0.7);
      const outputEst = tokens - inputEst;
      const cost = estimateCost(model, inputEst, outputEst);

      dayTotalTokens += tokens;
      dayTotalCost += cost;
      dayRequests += 1;
      byModel.push({ model, cost, tokens, requests: 1 });

      entries.push({
        id: `claude-stats-${date}-${model}`,
        timestamp: `${date}T12:00:00.000Z`,
        source: 'chat',
        service: 'claude-cli',
        provider: 'anthropic',
        model,
        backend: 'claude',
        totalTokens: tokens,
        inputTokens: inputEst,
        outputTokens: outputEst,
        cost,
      });
    }

    const activity = activityByDate.get(date);
    const byService = emptyServiceStats();
    byService['claude-cli'] = { cost: dayTotalCost, tokens: dayTotalTokens, requests: dayRequests };

    dailyMap.set(date, {
      date,
      totalCost: dayTotalCost,
      totalTokens: dayTotalTokens,
      totalRequests: activity?.messages || dayRequests,
      inputTokens: Math.round(dayTotalTokens * 0.7),
      outputTokens: Math.round(dayTotalTokens * 0.3),
      cacheReadTokens: 0,
      byService,
      byProvider: { anthropic: { cost: dayTotalCost, tokens: dayTotalTokens, requests: dayRequests } },
      byModel,
    });
  }

  return {
    daily: Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
    entries,
  };
}

/* ══════════════════════════════════════════════════════════
   4. Codex Session JSONL
   ══════════════════════════════════════════════════════════ */

type CodexSessionLine = {
  type: string;
  payload?: {
    type: string;
    info?: {
      total_token_usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens: number;
        total_tokens: number;
      };
    };
  };
};

export type CodexSessionsResult = {
  sessions: SessionRollup[];
  entries: UnifiedEntry[];
};

export async function readCodexSessionEntries(
  daysBack: number = 30,
): Promise<CodexSessionsResult> {
  const empty: CodexSessionsResult = { sessions: [], entries: [] };
  if (!CODEX_DATA_DIR) return empty;

  const sessionsDir = join(CODEX_DATA_DIR, 'sessions');
  const sessions: SessionRollup[] = [];
  const entries: UnifiedEntry[] = [];

  const now = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const year = String(d.getFullYear()).padStart(4, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayDir = join(sessionsDir, year, month, day);

    const files = await safeReadDir(dayDir);
    for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
      const filePath = join(resolve(dayDir), file);
      const raw = await safeReadFile(filePath);
      if (!raw) continue;

      const sessionId = file.replace('.jsonl', '');
      let fileStat;
      try { fileStat = await stat(filePath); } catch { continue; }

      let first: CodexSessionLine['payload'] | null = null;
      let latest: CodexSessionLine['payload'] | null = null;
      let eventCount = 0;

      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line) as CodexSessionLine;
          if (entry.payload?.type === 'token_count' && entry.payload.info?.total_token_usage) {
            eventCount++;
            if (!first) first = { ...entry.payload };
            latest = entry.payload;
          }
        } catch { /* skip */ }
      }

      if (!latest?.info?.total_token_usage) continue;
      const lastUsage = latest.info.total_token_usage;

      let inputTokens: number;
      let cachedInputTokens: number;
      let outputTokens: number;
      let reasoningTokens: number;

      if (eventCount > 1 && first?.info?.total_token_usage) {
        const fu = first.info.total_token_usage;
        const dI = lastUsage.input_tokens - fu.input_tokens;
        const dC = lastUsage.cached_input_tokens - fu.cached_input_tokens;
        const dO = lastUsage.output_tokens - fu.output_tokens;
        const dR = lastUsage.reasoning_output_tokens - fu.reasoning_output_tokens;
        if (dI < 0 || dC < 0 || dO < 0 || dR < 0) {
          inputTokens = lastUsage.input_tokens;
          cachedInputTokens = lastUsage.cached_input_tokens;
          outputTokens = lastUsage.output_tokens;
          reasoningTokens = lastUsage.reasoning_output_tokens;
        } else {
          inputTokens = dI; cachedInputTokens = dC; outputTokens = dO; reasoningTokens = dR;
        }
      } else {
        inputTokens = lastUsage.input_tokens;
        cachedInputTokens = lastUsage.cached_input_tokens;
        outputTokens = lastUsage.output_tokens;
        reasoningTokens = lastUsage.reasoning_output_tokens;
      }

      const nonCached = Math.max(0, inputTokens - cachedInputTokens);
      const totalTokens = nonCached + outputTokens + reasoningTokens;
      const cost = estimateCost('o3', nonCached, outputTokens + reasoningTokens);

      sessions.push({
        sessionId: `codex-${sessionId}`,
        label: `Codex session ${dateStr}/${sessionId.slice(0, 8)}`,
        service: 'codex-cli',
        startedAt: `${dateStr}T00:00:00.000Z`,
        lastActivityAt: fileStat.mtime.toISOString(),
        durationMs: fileStat.mtime.getTime() - fileStat.birthtime.getTime(),
        inputTokens,
        outputTokens,
        cacheReadTokens: cachedInputTokens,
        cacheWriteTokens: 0,
        totalTokens,
        totalCost: cost,
        messageCount: eventCount,
        toolCallCount: 0,
        model: 'codex (inferred)',
        provider: 'openai',
      });

      entries.push({
        id: `codex-session-${sessionId}`,
        timestamp: fileStat.mtime.toISOString(),
        source: 'chat',
        service: 'codex-cli',
        provider: 'openai',
        model: 'codex',
        backend: 'openai',
        inputTokens,
        outputTokens,
        cacheReadTokens: cachedInputTokens,
        totalTokens,
        cost,
        sessionId: `codex-${sessionId}`,
      });
    }
  }

  return { sessions, entries };
}

/* ══════════════════════════════════════════════════════════
   5. Gemini CLI Sessions (NEW)
   Reads ~/.gemini/tmp/{project}/chats/session-{id}.json
   Each session has messages with type "gemini" containing:
     { model, tokens: { input, output, cached, thoughts, tool, total } }
   ══════════════════════════════════════════════════════════ */

type GeminiMessage = {
  id: string;
  timestamp: string;
  type: 'user' | 'gemini' | 'info' | 'tool';
  content?: string;
  model?: string;
  tokens?: {
    input: number;
    output: number;
    cached: number;
    thoughts: number;
    tool: number;
    total: number;
  };
};

type GeminiSessionFile = {
  sessionId: string;
  projectHash?: string;
  startTime: string;
  lastUpdated: string;
  messages: GeminiMessage[];
};

export type GeminiSessionsResult = {
  sessions: SessionRollup[];
  entries: UnifiedEntry[];
};

export async function readGeminiSessionEntries(
  daysBack: number = 30,
): Promise<GeminiSessionsResult> {
  const empty: GeminiSessionsResult = { sessions: [], entries: [] };
  if (!GEMINI_DATA_DIR) return empty;

  const tmpDir = join(GEMINI_DATA_DIR, 'tmp');
  const projects = await safeReadDir(tmpDir);
  if (projects.length === 0) return empty;

  const sessions: SessionRollup[] = [];
  const entries: UnifiedEntry[] = [];
  const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  for (const project of projects) {
    const chatsDir = join(tmpDir, project, 'chats');
    const files = await safeReadDir(chatsDir);

    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const filePath = join(resolve(chatsDir), file);

      // Filter by mtime
      let fileStat;
      try { fileStat = await stat(filePath); } catch { continue; }
      if (fileStat.mtime.getTime() < cutoffMs) continue;

      const session = await safeReadJson<GeminiSessionFile>(filePath);
      if (!session || !session.messages || session.messages.length === 0) continue;

      // Aggregate token usage from all gemini response messages
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;
      let thoughtTokens = 0;
      let totalTokens = 0;
      let messageCount = 0;
      let toolCallCount = 0;
      let model: string | undefined;
      const models = new Set<string>();

      for (const msg of session.messages) {
        if (msg.type === 'gemini') {
          messageCount++;
          if (msg.model) {
            model = msg.model;
            models.add(msg.model);
          }
          if (msg.tokens) {
            inputTokens += msg.tokens.input || 0;
            outputTokens += msg.tokens.output || 0;
            cachedTokens += msg.tokens.cached || 0;
            thoughtTokens += msg.tokens.thoughts || 0;
            totalTokens += msg.tokens.total || 0;
          }
        } else if (msg.type === 'user') {
          messageCount++;
        } else if (msg.type === 'tool') {
          toolCallCount++;
        }
      }

      if (totalTokens === 0 && messageCount <= 1) continue;

      const primaryModel = model || 'gemini-2.5-pro';
      // For Gemini, billable input = input - cached, output includes thoughts
      const billableInput = Math.max(0, inputTokens - cachedTokens);
      const billableOutput = outputTokens + thoughtTokens;
      const cost = estimateCost(primaryModel, billableInput, billableOutput, cachedTokens);

      const sessionId = session.sessionId || file.replace('.json', '');
      const startedAt = session.startTime || fileStat.birthtime.toISOString();
      const lastActivityAt = session.lastUpdated || fileStat.mtime.toISOString();

      sessions.push({
        sessionId: `gemini-${sessionId}`,
        label: `Gemini ${project}/${sessionId.slice(0, 8)}`,
        service: 'gemini-cli',
        startedAt,
        lastActivityAt,
        durationMs: new Date(lastActivityAt).getTime() - new Date(startedAt).getTime(),
        inputTokens,
        outputTokens: outputTokens + thoughtTokens,
        cacheReadTokens: cachedTokens,
        cacheWriteTokens: 0,
        totalTokens,
        totalCost: cost,
        messageCount,
        toolCallCount,
        model: primaryModel,
        provider: 'google',
        models: Array.from(models),
      });

      entries.push({
        id: `gemini-session-${sessionId}`,
        timestamp: lastActivityAt,
        source: 'chat',
        service: 'gemini-cli',
        provider: 'google',
        model: primaryModel,
        backend: 'google',
        inputTokens,
        outputTokens: outputTokens + thoughtTokens,
        cacheReadTokens: cachedTokens,
        totalTokens,
        cost,
        sessionId: `gemini-${sessionId}`,
      });
    }
  }

  // Sort by last activity descending
  sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  return { sessions, entries };
}

/* ══════════════════════════════════════════════════════════
   6. Ollama (self-hosted)
   Reads from Ollama API /api/ps for running models.
   Since Ollama doesn't persist usage history, we track
   what's currently loaded and create volume-only entries.
   Future: wrap with a logging proxy for full tracking.
   ══════════════════════════════════════════════════════════ */

export type OllamaStatus = {
  available: boolean;
  loadedModels: Array<{
    name: string;
    sizeBytes: number;
    expiresAt: string;
  }>;
};

export async function readOllamaStatus(): Promise<OllamaStatus> {
  const unavailable: OllamaStatus = { available: false, loadedModels: [] };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${OLLAMA_HOST}/api/ps`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return unavailable;
    const data = await res.json() as { models?: Array<{ name: string; size: number; expires_at: string }> };

    return {
      available: true,
      loadedModels: (data.models || []).map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        expiresAt: m.expires_at,
      })),
    };
  } catch {
    return unavailable;
  }
}

/* ══════════════════════════════════════════════════════════
   7. CodexBar Snapshot
   ══════════════════════════════════════════════════════════ */

export async function readCodexBarSnapshot(): Promise<CodexBarSnapshot | null> {
  if (!CODEXBAR_DATA_DIR) return null;

  const meta = await safeReadJson<{
    collectedAt: string;
    hostname?: string;
    errors?: number;
  }>(join(CODEXBAR_DATA_DIR, 'codexbar-meta.json'));
  if (!meta) return null;

  const providers: CodexBarProviderCost[] = [];

  for (const providerName of ['codex', 'claude']) {
    const costData = await safeReadJson<unknown>(
      join(CODEXBAR_DATA_DIR, `codexbar-cost-${providerName}.json`),
    );
    if (!costData) continue;

    const arr = Array.isArray(costData) ? costData : [costData];
    const entry = arr.find(
      (e: Record<string, unknown>) =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).provider === providerName,
    ) as Record<string, unknown> | undefined;
    if (!entry) continue;

    const daily = Array.isArray(entry.daily)
      ? entry.daily.map((d: Record<string, unknown>) => ({
          date: String(d.date || ''),
          inputTokens: Number(d.inputTokens || 0),
          outputTokens: Number(d.outputTokens || 0),
          cacheReadTokens: Number(d.cacheReadTokens || 0),
          cacheCreationTokens: Number(d.cacheCreationTokens || 0),
          totalTokens: Number(d.totalTokens || 0),
          totalCost: Number(d.totalCost || 0),
          modelsUsed: Array.isArray(d.modelsUsed) ? d.modelsUsed.map(String) : [],
          modelBreakdowns: Array.isArray(d.modelBreakdowns)
            ? d.modelBreakdowns.map((mb: Record<string, unknown>) => ({
                modelName: String(mb.modelName || ''),
                cost: Number(mb.cost || 0),
              }))
            : [],
        }))
      : [];

    const totals = entry.totals as Record<string, unknown> | undefined;
    providers.push({
      provider: providerName,
      sessionTokens: Number(entry.sessionTokens || 0),
      sessionCostUSD: Number(entry.sessionCostUSD || 0),
      last30DaysTokens: Number(entry.last30DaysTokens || 0),
      last30DaysCostUSD: Number(entry.last30DaysCostUSD || 0),
      daily,
      totals: totals ? {
        totalInputTokens: Number(totals.totalInputTokens || 0),
        totalOutputTokens: Number(totals.totalOutputTokens || 0),
        cacheReadTokens: Number(totals.cacheReadTokens || 0),
        cacheCreationTokens: Number(totals.cacheCreationTokens || 0),
        totalTokens: Number(totals.totalTokens || 0),
        totalCost: Number(totals.totalCost || 0),
      } : undefined,
    });
  }

  let usage: CodexBarUsageProvider[] | undefined;
  const usageData = await safeReadJson<unknown>(join(CODEXBAR_DATA_DIR, 'codexbar-usage.json'));
  if (usageData && Array.isArray(usageData)) {
    usage = usageData
      .filter((u: unknown): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .map((u) => {
        const primary = u.primary as Record<string, unknown> | undefined;
        const secondary = u.secondary as Record<string, unknown> | undefined;
        return {
          provider: String(u.provider || ''),
          primary: {
            usedPercent: Number(primary?.usedPercent ?? primary?.used_percent ?? 0),
            resetsAt: String(primary?.resetsAt ?? primary?.resets_at ?? ''),
            windowMinutes: Number(primary?.windowMinutes ?? primary?.window_minutes ?? 0),
          },
          secondary: secondary ? {
            usedPercent: Number(secondary?.usedPercent ?? secondary?.used_percent ?? 0),
            resetsAt: String(secondary?.resetsAt ?? secondary?.resets_at ?? ''),
            windowMinutes: Number(secondary?.windowMinutes ?? secondary?.window_minutes ?? 0),
          } : undefined,
        };
      });
  }

  return { collectedAt: meta.collectedAt, hostname: meta.hostname, errors: meta.errors, providers, usage };
}

/* ══════════════════════════════════════════════════════════
   8. OpenClaw Gateway Sessions
   ══════════════════════════════════════════════════════════ */

type OpenClawMessage = {
  type?: string;
  role?: string;
  timestamp?: string | number;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    content?: string | Array<{ text?: string }>;
  };
  origin?: { surface?: string; label?: string; chatType?: string; from?: string; threadId?: string | number };
  channel?: string;
  model?: string;
  provider?: string;
};

function classifySessionService(
  origin?: { surface?: string; chatType?: string },
  channel?: string,
): ServiceId {
  const surface = origin?.surface?.toLowerCase() || '';
  const ch = channel?.toLowerCase() || '';
  if (surface === 'zulip' || ch.includes('zulip')) return 'zulip-bot';
  return 'clawdbot';
}

function extractFirstUserMessage(lines: string[]): string {
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as OpenClawMessage;
      if (msg.type === 'user' || msg.role === 'user') {
        const content = msg.message?.content;
        if (typeof content === 'string') {
          return content.length > 80 ? content.slice(0, 77) + '...' : content;
        }
        if (Array.isArray(content)) {
          const text = content.find((c) => c.text)?.text;
          if (text) return text.length > 80 ? text.slice(0, 77) + '...' : text;
        }
      }
    } catch { /* skip */ }
  }
  return '';
}

export async function readOpenClawSessions(daysBack: number = 30): Promise<SessionRollup[]> {
  if (!OPENCLAW_SESSIONS_DIR) return [];

  const files = await safeReadDir(OPENCLAW_SESSIONS_DIR);
  const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const sessions: SessionRollup[] = [];

  for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
    const filePath = join(resolve(OPENCLAW_SESSIONS_DIR), file);
    let fileStat;
    try { fileStat = await stat(filePath); } catch { continue; }
    if (fileStat.mtime.getTime() < cutoffMs) continue;

    const raw = await safeReadFile(filePath);
    if (!raw) continue;
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    const sessionId = file.replace('.jsonl', '');
    let origin: OpenClawMessage['origin'] | undefined;
    let channel: string | undefined;
    let model: string | undefined;
    let provider: string | undefined;
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
    let messageCount = 0, toolCallCount = 0;
    let firstTimestamp: number | undefined, lastTimestamp: number | undefined;
    const models = new Set<string>();

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as OpenClawMessage;
        if (!origin && msg.origin) origin = msg.origin;
        if (!channel && msg.channel) channel = msg.channel;
        if (!model && (msg.model || msg.message?.model)) model = msg.model || msg.message?.model;
        if (!provider && msg.provider) provider = msg.provider;

        const ts = msg.timestamp
          ? typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp).getTime()
          : undefined;
        if (ts) {
          if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
          if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
        }

        const type = msg.type || msg.role;
        if (type === 'user' || type === 'assistant') messageCount++;
        if (type === 'tool_call' || type === 'tool_use') toolCallCount++;

        const usage = msg.message?.usage;
        if (usage) {
          inputTokens += usage.input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
          cacheReadTokens += usage.cache_read_input_tokens || 0;
          cacheWriteTokens += usage.cache_creation_input_tokens || 0;
          if (msg.message?.model) models.add(msg.message.model);
        }
      } catch { /* skip */ }
    }

    if (messageCount === 0) continue;

    const totalTokens = inputTokens + outputTokens;
    const primaryModel = model || (models.size > 0 ? Array.from(models)[0] : undefined);
    const totalCost = primaryModel
      ? estimateCost(primaryModel, Math.max(0, inputTokens - cacheReadTokens), outputTokens, cacheReadTokens, cacheWriteTokens)
      : 0;

    const service = classifySessionService(origin, channel);
    const userMsg = extractFirstUserMessage(lines);
    const label = userMsg || origin?.label || (channel ? `${channel} session` : `Session ${sessionId.slice(0, 12)}`);

    sessions.push({
      sessionId: `openclaw-${sessionId}`,
      label,
      service,
      channel,
      startedAt: firstTimestamp ? new Date(firstTimestamp).toISOString() : fileStat.birthtime.toISOString(),
      lastActivityAt: lastTimestamp ? new Date(lastTimestamp).toISOString() : fileStat.mtime.toISOString(),
      durationMs: (lastTimestamp && firstTimestamp) ? lastTimestamp - firstTimestamp : 0,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      totalCost,
      messageCount,
      toolCallCount,
      model: primaryModel,
      provider: provider || (primaryModel ? normalizeBackend(primaryModel) : 'unknown'),
      models: Array.from(models),
    });
  }

  sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  return sessions;
}

/* ══════════════════════════════════════════════════════════
   9. Embedding Cost Entries
   ══════════════════════════════════════════════════════════ */

const EMBEDDING_COSTS_DIR =
  process.env.OPENCLAW_EMBEDDING_COSTS_DIR ||
  (config.openclawHome
    ? join(config.openclawHome, 'memory', 'embedding-costs')
    : join(HOME, '.openclaw', 'memory', 'embedding-costs'));

export async function readEmbeddingCostEntries(daysBack: number = 30): Promise<UnifiedEntry[]> {
  const files = await safeReadDir(EMBEDDING_COSTS_DIR);
  if (files.length === 0) return [];

  const entries: UnifiedEntry[] = [];
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
    const agentId = file.replace(/-embedding-costs\.jsonl$/, '');
    const content = await safeReadFile(join(EMBEDDING_COSTS_DIR, file));
    if (!content) continue;

    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        const ts = typeof entry.timestamp === 'number' ? entry.timestamp : 0;
        if (ts < cutoff) continue;

        entries.push({
          id: `embed-${agentId}-${ts}`,
          timestamp: new Date(ts).toISOString(),
          source: 'unknown' as UsageSource,
          service: 'other' as ServiceId,
          provider: typeof entry.provider === 'string' ? entry.provider : 'openai',
          model: typeof entry.model === 'string' ? entry.model : 'text-embedding-3-small',
          backend: normalizeBackend(typeof entry.provider === 'string' ? entry.provider : 'openai'),
          totalTokens: typeof entry.tokens === 'number' ? entry.tokens : 0,
          cost: typeof entry.estimatedCost === 'number' ? entry.estimatedCost : 0,
          summary: `Embedding: ${agentId} memory indexing`,
          sessionId: `embed:${agentId}`,
          channel: 'memory-index',
        });
      } catch { /* skip */ }
    }
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries;
}
