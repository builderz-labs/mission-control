#!/usr/bin/env node
/**
 * mc-memory-review.cjs — Weekly memory review job (script-based).
 * Reads memory_entries that are pending review, appends summary to
 * logs/mc/memory-review.jsonl.
 *
 * Idempotent: running twice in the same UTC day is a no-op (checks
 * today's date in the log before writing).
 *
 * Env overrides (for testing):
 *   MC_LOG_DIR      — base log directory (default: logs/mc)
 *   MC_ROOT         — project root (default: repo root)
 *   MC_REVIEW_DATE  — override today's date string (YYYY-MM-DD) for testing
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const SCRIPT_ROOT = path.resolve(__dirname, '..');
const MC_ROOT     = process.env.MC_ROOT    || SCRIPT_ROOT;
const LOG_DIR     = process.env.MC_LOG_DIR || path.join(SCRIPT_ROOT, 'logs', 'mc');
const REVIEW_LOG  = path.join(LOG_DIR, 'memory-review.jsonl');

const DB_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'mission-control', '.data', 'mission-control.db'
);

function todayUtc() {
  if (process.env.MC_REVIEW_DATE) return process.env.MC_REVIEW_DATE;
  return new Date().toISOString().slice(0, 10);
}

function readLog() {
  try {
    return fs.readFileSync(REVIEW_LOG, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function alreadyRanToday(log, today) {
  return log.some(e => e.date === today);
}

function runReview() {
  const today = todayUtc();

  fs.mkdirSync(LOG_DIR, { recursive: true });

  const existing = readLog();
  if (alreadyRanToday(existing, today)) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: 'already ran today',
      date: today,
    }));
    return;
  }

  // Read from DB directly (offline path — does not require server to be running)
  let entries = [];
  let error = null;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    entries = db.prepare(`
      SELECT id, source, category, content, tags, created_at
      FROM memory_entries
      WHERE tags LIKE '%outcome:unknown%'
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    db.close();
  } catch (e) {
    error = e.message;
  }

  const record = {
    date: today,
    timestamp: new Date().toISOString(),
    pending_review: entries.length,
    high_risk_count: entries.filter(e =>
      (e.tags || '').includes('failure') || (e.tags || '').includes('risk:high')
    ).length,
    entries_sample: entries.slice(0, 5).map(e => ({
      id: e.id, source: e.source, category: e.category,
      content_preview: (e.content || '').slice(0, 100),
    })),
    ...(error ? { db_error: error } : {}),
  };

  fs.appendFileSync(REVIEW_LOG, JSON.stringify(record) + '\n', 'utf-8');

  console.log(JSON.stringify({
    status: 'ok',
    date: today,
    pending_review: record.pending_review,
    high_risk_count: record.high_risk_count,
    ...(error ? { db_error: error } : {}),
  }));
}

runReview();
