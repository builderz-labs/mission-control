/**
 * Lionroot Usage Ledger API
 *
 * GET /api/lionroot/usage-ledger
 *   ?days=30           — lookback window (default 30)
 *   ?service=claude-cli — filter to a single service
 *
 * Aggregates token usage across all configured data sources:
 *   - Claude CLI  (~/.claude/stats-cache.json)
 *   - Codex CLI   (~/.codex/sessions/)
 *   - Gemini CLI  (~/.gemini/tmp/{project}/chats/)
 *   - Ollama      (API /api/ps — status only)
 *   - CodexBar    (collected dashboard data)
 *   - OpenClaw    (gateway session JSONL)
 *   - Cron        (cron run-logs)
 *   - Embeddings  (embedding cost JSONL)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type { LedgerResponse, ServiceId } from '@/lib/lionroot/usage/types';
import {
  loadJobMap,
  readCronEntries,
  readClaudeStatsCache,
  readCodexSessionEntries,
  readGeminiSessionEntries,
  readOllamaStatus,
  readCodexBarSnapshot,
  readOpenClawSessions,
  readEmbeddingCostEntries,
} from '@/lib/lionroot/usage/readers';
import {
  buildSummary,
  buildDailyBuckets,
  buildServiceBreakdown,
  buildCostInsights,
  deduplicateEntries,
} from '@/lib/lionroot/usage/aggregation';

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Number(searchParams.get('days') || '30'), 90);
    const serviceFilter = searchParams.get('service') as ServiceId | null;

    // Read all sources in parallel
    const jobMap = await loadJobMap();

    const [
      cronEntries,
      claudeResult,
      codexResult,
      geminiResult,
      ollamaStatus,
      codexbar,
      openclawSessions,
      embeddingEntries,
    ] = await Promise.all([
      readCronEntries(jobMap),
      readClaudeStatsCache(),
      readCodexSessionEntries(days),
      readGeminiSessionEntries(days),
      readOllamaStatus(),
      readCodexBarSnapshot(),
      readOpenClawSessions(days),
      readEmbeddingCostEntries(days),
    ]);

    // Merge all entries
    let allEntries = [
      ...cronEntries,
      ...claudeResult.entries,
      ...codexResult.entries,
      ...geminiResult.entries,
      ...embeddingEntries,
    ];

    // Deduplicate overlapping sources
    allEntries = deduplicateEntries(allEntries);

    // Filter out deduplicated entries
    allEntries = allEntries.filter((e) => !e.deduplicated);

    // Apply date filter
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();
    allEntries = allEntries.filter((e) => e.timestamp >= cutoffStr);

    // Merge all sessions
    let allSessions = [
      ...codexResult.sessions,
      ...geminiResult.sessions,
      ...openclawSessions,
    ];

    // Apply service filter if specified
    if (serviceFilter) {
      allEntries = allEntries.filter((e) => (e.service || 'other') === serviceFilter);
      allSessions = allSessions.filter((s) => s.service === serviceFilter);
    }

    // Sort entries by timestamp descending
    allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Build aggregations
    const summary = buildSummary(allEntries);
    const daily = buildDailyBuckets(allEntries, codexbar, claudeResult.daily);
    const byService = buildServiceBreakdown(allEntries, allSessions);
    const insights = buildCostInsights(allEntries, allSessions, codexbar);

    const response: LedgerResponse = {
      entries: allEntries.slice(0, 200), // Cap entries in response
      total: allEntries.length,
      summary,
      daily,
      sessions: allSessions.slice(0, 100),
      codexbar,
      byService,
      insights,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error({ err: error }, 'Usage Ledger API error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
