import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from './logger';

const CC_DB_PATH = process.env.CC_DB_PATH || join(homedir(), '.openclaw', 'control-center.db');

let ccDb: Database.Database | null = null;

// --- New status & column types ---

export type IssueStatus = 'draft' | 'open' | 'closed';
export type KanbanColumn = 'drafts' | 'open' | 'closed';
export type BadgeType = 'idea' | 'proposal' | null;

// Known agents (non-human creators produce "proposal" badge)
const HUMAN_USERS = new Set(['cri']);

/**
 * Derive which kanban column an issue belongs to.
 *
 * | Column  | Rule             |
 * |---------|------------------|
 * | drafts  | status = 'draft' |
 * | open    | status = 'open'  |
 * | closed  | status = 'closed'|
 */
export function deriveColumn(issue: { status: string; assignee: string }): KanbanColumn {
  const s = issue.status as IssueStatus;
  if (s === 'closed') return 'closed';
  if (s === 'draft') return 'drafts';
  return 'open';
}

/**
 * Derive badge type from status + creator.
 * Badges only apply to draft tasks:
 * - "idea" = draft created by a human
 * - "proposal" = draft created by an agent
 */
export function deriveBadge(status: string, creator: string): BadgeType {
  if (status !== 'draft') return null;
  if (!creator) return null;
  return HUMAN_USERS.has(creator.toLowerCase()) ? 'idea' : 'proposal';
}

/**
 * Get read-only connection to control-center.db.
 * Used by other openclaw processes — open read-only by default.
 */
export function getCCDatabase(readonly = true): Database.Database {
  if (!ccDb) {
    ccDb = new Database(CC_DB_PATH, { readonly });
    ccDb.pragma('journal_mode = WAL');
    ccDb.pragma('synchronous = NORMAL');
    ccDb.pragma('foreign_keys = ON');
    logger.info(`Connected to control-center.db at ${CC_DB_PATH} (readonly=${readonly})`);
  }
  return ccDb;
}

/**
 * Get a writable connection to control-center.db.
 * Opens a separate short-lived connection to avoid blocking other processes.
 */
export function getCCDatabaseWrite(): Database.Database {
  const db = new Database(CC_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Run schema migrations on control-center.db.
 * Adds `creator` column and migrates old statuses to new ones.
 * Safe to call multiple times — idempotent.
 */
export function runCCMigrations(): void {
  const db = getCCDatabaseWrite();
  try {
    // 1. Add creator column if missing
    const issueColumns = db.prepare('PRAGMA table_info(issues)').all() as Array<{ name: string }>;
    const hasCreator = issueColumns.some(c => c.name === 'creator');
    if (!hasCreator) {
      db.exec(`ALTER TABLE issues ADD COLUMN creator TEXT DEFAULT ''`);
      logger.info('cc-db migration: added creator column to issues');
    }

    // 2. Add attachments column to issue_comments if missing
    const commentColumns = db.prepare('PRAGMA table_info(issue_comments)').all() as Array<{ name: string }>;
    const hasAttachments = commentColumns.some(c => c.name === 'attachments');
    if (!hasAttachments) {
      db.exec(`ALTER TABLE issue_comments ADD COLUMN attachments TEXT DEFAULT '[]'`);
      logger.info('cc-db migration: added attachments column to issue_comments');
    }

    // 3. Create turns table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL CHECK(type IN ('instruction','result','note')),
        author TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        links TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_turns_task_id ON turns(task_id)');

    // 4. Add new columns to issues for turns system
    const issueCols = db.prepare('PRAGMA table_info(issues)').all() as Array<{ name: string }>;
    const issueColNames = new Set(issueCols.map(c => c.name));

    if (!issueColNames.has('last_turn_at')) {
      db.exec(`ALTER TABLE issues ADD COLUMN last_turn_at TEXT`);
      logger.info('cc-db migration: added last_turn_at column to issues');
    }
    if (!issueColNames.has('seen_at')) {
      db.exec(`ALTER TABLE issues ADD COLUMN seen_at TEXT`);
      logger.info('cc-db migration: added seen_at column to issues');
    }
    if (!issueColNames.has('picked')) {
      db.exec(`ALTER TABLE issues ADD COLUMN picked INTEGER DEFAULT 0`);
      logger.info('cc-db migration: added picked column to issues');
    }
    if (!issueColNames.has('picked_at')) {
      db.exec(`ALTER TABLE issues ADD COLUMN picked_at TEXT`);
      logger.info('cc-db migration: added picked_at column to issues');
    }
    if (!issueColNames.has('picked_by')) {
      db.exec(`ALTER TABLE issues ADD COLUMN picked_by TEXT DEFAULT ''`);
      logger.info('cc-db migration: added picked_by column to issues');
    }
    if (!issueColNames.has('blocked_by')) {
      db.exec(`ALTER TABLE issues ADD COLUMN blocked_by TEXT DEFAULT '[]'`);
      logger.info('cc-db migration: added blocked_by column to issues');
    }

    // 5. Migrate existing comments to turns (as notes, round 0)
    const turnsExist = (db.prepare('SELECT COUNT(*) as c FROM turns').get() as { c: number }).c;
    const commentsExist = (db.prepare('SELECT COUNT(*) as c FROM issue_comments').get() as { c: number }).c;
    if (turnsExist === 0 && commentsExist > 0) {
      db.exec(`
        INSERT INTO turns (id, task_id, round_number, type, author, content, links, created_at, updated_at)
        SELECT id, issue_id, 0, 'note', author, content, COALESCE(attachments, '[]'), created_at, created_at
        FROM issue_comments
        WHERE NOT EXISTS (SELECT 1 FROM turns WHERE turns.id = issue_comments.id)
      `);
      logger.info('cc-db migration: migrated existing comments to turns');

      // Update last_turn_at for tasks that have migrated turns
      db.exec(`
        UPDATE issues SET last_turn_at = (SELECT MAX(created_at) FROM turns WHERE turns.task_id = issues.id)
        WHERE last_turn_at IS NULL AND EXISTS (SELECT 1 FROM turns WHERE turns.task_id = issues.id)
      `);
      logger.info('cc-db migration: updated last_turn_at from migrated turns');
    }

    // 6. Migrate old statuses → 3-status model (draft, open, closed)
    //    Active work statuses → open
    //    Proposal/idea/todo → draft (not yet actionable)
    //    done → closed
    const statusMigrations: [string, string][] = [
      ['assigned', 'open'],
      ['in_progress', 'open'],
      ['review', 'open'],
      ['blocked', 'open'],
      ['idea', 'draft'],
      ['proposal', 'draft'],
      ['todo', 'draft'],
      ['done', 'closed'],
    ];

    for (const [oldStatus, newStatus] of statusMigrations) {
      const result = db.prepare('UPDATE issues SET status = ? WHERE status = ?').run(newStatus, oldStatus);
      if (result.changes > 0) {
        logger.info(`cc-db migration: migrated ${result.changes} issues from '${oldStatus}' to '${newStatus}'`);
      }
    }

    logger.info('cc-db migrations complete');
  } finally {
    db.close();
  }

  // Reset cached read-only connection so it picks up schema changes
  if (ccDb) {
    ccDb.close();
    ccDb = null;
  }
}

// --- Raw row types from control-center.db ---

export interface CCIssue {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  assignee: string;
  creator: string;
  priority: 'low' | 'normal' | 'high';
  created_at: string; // ISO
  updated_at: string; // ISO
  archived: number;
  schedule: string;
  parent_id: string | null;
  notion_id: string;
  plan_path: string | null;
  last_turn_at: string | null;
  seen_at: string | null;
  picked: number;
  picked_at: string | null;
  picked_by: string;
  blocked_by: string; // JSON array of task IDs e.g. '["uuid1","uuid2"]'
}

export interface CCProject {
  id: string;
  title: string;
  description: string;
  emoji: string;
  created_at: string;
  updated_at: string;
  archived: number;
  schedule: string;
  repo_url: string;
  local_path: string;
}

export interface CCComment {
  id: string;
  issue_id: string;
  author: string;
  content: string;
  created_at: string; // ISO
  attachments?: string; // JSON array of {url, filename, originalName?}
}

// --- Turn types ---

export type TurnType = 'instruction' | 'result' | 'note'

export interface Turn {
  id: string
  task_id: string
  round_number: number
  type: TurnType
  author: string
  content: string
  links: Array<{ url: string; title?: string; type?: string }>
  created_at: string
  updated_at: string
}

interface TurnRow {
  id: string
  task_id: string
  round_number: number
  type: string
  author: string
  content: string
  links: string
  created_at: string
  updated_at: string
}

function parseTurnRow(row: TurnRow): Turn {
  let links: Turn['links'] = []
  try { links = JSON.parse(row.links || '[]') } catch { links = [] }
  return {
    id: row.id,
    task_id: row.task_id,
    round_number: row.round_number,
    type: row.type as TurnType,
    author: row.author,
    content: row.content,
    links,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function getTurns(taskId: string): Turn[] {
  const db = getCCDatabase()
  const rows = db.prepare(
    'SELECT * FROM turns WHERE task_id = ? ORDER BY round_number ASC, created_at ASC'
  ).all(taskId) as TurnRow[]
  return rows.map(parseTurnRow)
}

export function getCurrentRound(taskId: string): number {
  const db = getCCDatabase()
  const row = db.prepare(
    'SELECT MAX(round_number) as max_round FROM turns WHERE task_id = ?'
  ).get(taskId) as { max_round: number | null } | undefined
  return row?.max_round ?? 0
}

export function createTurn(
  taskId: string,
  turn: { type: TurnType; author: string; content: string; links?: Turn['links']; assigned_to?: string }
): Turn {
  const writeDb = getCCDatabaseWrite()
  try {
    const id = randomUUID()
    const now = new Date().toISOString()
    const linksJson = JSON.stringify(turn.links || [])

    let roundNumber: number

    if (turn.type === 'instruction') {
      // New instruction = new round
      const currentMax = (writeDb.prepare(
        'SELECT MAX(round_number) as max_round FROM turns WHERE task_id = ?'
      ).get(taskId) as { max_round: number | null })?.max_round ?? 0
      roundNumber = currentMax + 1

      // Reassign task + reset picked + reopen if done/closed
      writeDb.prepare(
        `UPDATE issues SET assignee = ?, picked = 0, picked_at = NULL, last_turn_at = ?, updated_at = ?,
         status = CASE WHEN status IN ('done', 'closed') THEN 'open' ELSE status END
         WHERE id = ?`
      ).run(turn.assigned_to || '', now, now, taskId)

    } else if (turn.type === 'result') {
      // Result completes current round
      const currentMax = (writeDb.prepare(
        'SELECT MAX(round_number) as max_round FROM turns WHERE task_id = ? AND type = \'instruction\''
      ).get(taskId) as { max_round: number | null })?.max_round ?? 1
      roundNumber = currentMax

      // Agent-to-agent routing: if assigned_to is explicitly set, use it (enables pipelines)
      // Otherwise: team-aware routing — builders route to their PM, PMs route to cri
      // Fallback: instruction author, then cri
      const TEAM_ROUTING: Record<string, string> = {
        dumbo: 'ralph', ralph: 'cri',   // Skunkworks
        cody: 'piem',   piem: 'cri',    // Devz
      }
      let reassignTo: string
      if (turn.assigned_to) {
        reassignTo = turn.assigned_to
      } else if (TEAM_ROUTING[turn.author]) {
        reassignTo = TEAM_ROUTING[turn.author]
      } else {
        const instructionRow = writeDb.prepare(
          'SELECT author FROM turns WHERE task_id = ? AND round_number = ? AND type = \'instruction\' LIMIT 1'
        ).get(taskId, currentMax) as { author: string } | undefined
        reassignTo = instructionRow?.author || 'cri'
      }

      writeDb.prepare(
        'UPDATE issues SET assignee = ?, picked = 0, picked_at = NULL, last_turn_at = ?, updated_at = ? WHERE id = ?'
      ).run(reassignTo, now, now, taskId)

    } else {
      // Note — use current round (or 0 if none)
      const currentMax = (writeDb.prepare(
        'SELECT MAX(round_number) as max_round FROM turns WHERE task_id = ?'
      ).get(taskId) as { max_round: number | null })?.max_round ?? 0
      roundNumber = currentMax

      // Just update last_turn_at
      writeDb.prepare(
        'UPDATE issues SET last_turn_at = ?, updated_at = ? WHERE id = ?'
      ).run(now, now, taskId)
    }

    writeDb.prepare(`
      INSERT INTO turns (id, task_id, round_number, type, author, content, links, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, taskId, roundNumber, turn.type, turn.author, turn.content, linksJson, now, now)

    return {
      id,
      task_id: taskId,
      round_number: roundNumber,
      type: turn.type,
      author: turn.author,
      content: turn.content,
      links: turn.links || [],
      created_at: now,
      updated_at: now,
    }
  } finally {
    writeDb.close()
  }
}

export function updateTurn(turnId: string, content: string): void {
  const writeDb = getCCDatabaseWrite()
  try {
    const now = new Date().toISOString()
    writeDb.prepare(
      'UPDATE turns SET content = ?, updated_at = ? WHERE id = ? AND type = \'note\''
    ).run(content, now, turnId)
  } finally {
    writeDb.close()
  }
}

export function setTaskPicked(taskId: string, agent?: string): void {
  const writeDb = getCCDatabaseWrite()
  try {
    const now = new Date().toISOString()
    writeDb.prepare(
      'UPDATE issues SET picked = 1, picked_at = ?, picked_by = ? WHERE id = ?'
    ).run(now, agent || '', taskId)
  } finally {
    writeDb.close()
  }
}

export function setTaskSeen(taskId: string): void {
  const writeDb = getCCDatabaseWrite()
  try {
    const now = new Date().toISOString()
    writeDb.prepare(
      'UPDATE issues SET seen_at = ? WHERE id = ?'
    ).run(now, taskId)
  } finally {
    writeDb.close()
  }
}

// --- Priority mapping (CC uses low/normal/high, MC uses low/medium/high) ---

const PRIORITY_TO_MC: Record<string, string> = {
  low: 'low',
  normal: 'medium',
  high: 'high',
};

const PRIORITY_FROM_MC: Record<string, string> = {
  low: 'low',
  medium: 'normal',
  high: 'high',
  urgent: 'high',
};

function isoToUnix(iso: string): number {
  const d = new Date(iso);
  return Math.floor(d.getTime() / 1000);
}

// --- Query functions ---

export function getIssues(opts?: {
  status?: string;
  assigned_to?: string;
  priority?: string;
  column?: KanbanColumn;
  limit?: number;
  offset?: number;
}): { issues: CCIssue[]; total: number } {
  const db = getCCDatabase();

  let where = 'WHERE i.archived = 0';
  const params: any[] = [];

  if (opts?.status) {
    where += ' AND i.status = ?';
    params.push(opts.status);
  }
  if (opts?.assigned_to) {
    where += ' AND LOWER(i.assignee) = LOWER(?)';
    params.push(opts.assigned_to);
  }
  if (opts?.priority) {
    const ccPriority = PRIORITY_FROM_MC[opts.priority] || opts.priority;
    where += ' AND i.priority = ?';
    params.push(ccPriority);
  }

  // Column-based filtering (derived, not stored)
  if (opts?.column) {
    switch (opts.column) {
      case 'drafts':
        where += ` AND i.status = 'draft'`;
        break;
      case 'open':
        where += ` AND i.status = 'open'`;
        break;
      case 'closed':
        where += ` AND i.status = 'closed'`;
        break;
    }
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM issues i ${where}`).get(...params) as { total: number };

  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;
  const issues = db.prepare(`
    SELECT i.*, (
      SELECT MAX(c.created_at) FROM issue_comments c WHERE c.issue_id = i.id
    ) AS last_comment_at
    FROM issues i ${where}
    ORDER BY COALESCE(i.last_turn_at, i.updated_at) DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as (CCIssue & { last_comment_at: string | null })[];

  return { issues, total: countRow.total };
}

export function getIssue(id: string): CCIssue | undefined {
  const db = getCCDatabase();
  return db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as CCIssue | undefined;
}

export function getProjects(): CCProject[] {
  const db = getCCDatabase();
  return db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY title').all() as CCProject[];
}

export function getProject(id: string): CCProject | undefined {
  const db = getCCDatabase();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as CCProject | undefined;
}

export function getIssueComments(issueId: string): CCComment[] {
  const db = getCCDatabase();
  return db.prepare('SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC')
    .all(issueId) as CCComment[];
}

// --- Map CC issue -> MC Task shape ---

export function mapIssueToTask(issue: CCIssue & { last_comment_at?: string | null }, projectTitle?: string) {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description || '',
    status: issue.status,
    column: deriveColumn(issue),
    badge: deriveBadge(issue.status, issue.creator || ''),
    priority: PRIORITY_TO_MC[issue.priority] || 'medium',
    assigned_to: issue.assignee || '',
    creator: issue.creator || '',
    created_at: isoToUnix(issue.created_at),
    updated_at: isoToUnix(issue.updated_at),
    last_activity_at: issue.last_turn_at
      ? Math.max(isoToUnix(issue.updated_at), isoToUnix(issue.last_turn_at))
      : issue.last_comment_at
        ? Math.max(isoToUnix(issue.updated_at), isoToUnix(issue.last_comment_at))
        : isoToUnix(issue.updated_at),
    tags: [],
    metadata: {
      project_id: issue.project_id || '',
      project_title: projectTitle || '',
      parent_id: issue.parent_id || '',
      schedule: issue.schedule || '',
      source: 'control-center',
    },
    project_id: issue.project_id || '',
    project_title: projectTitle || '',
    plan_path: issue.plan_path || null,
    last_turn_at: issue.last_turn_at ? isoToUnix(issue.last_turn_at) : null,
    seen_at: issue.seen_at ? isoToUnix(issue.seen_at) : null,
    picked: issue.picked ?? 0,
    picked_at: issue.picked_at ? isoToUnix(issue.picked_at) : null,
    picked_by: issue.picked_by || '',
    blocked_by: parseBlockedBy(issue.blocked_by),
  };
}

// --- Map CC comment -> MC Comment shape ---

export function mapCCComment(c: CCComment) {
  let attachments: Array<{ url: string; filename: string; originalName?: string }> = [];
  if (c.attachments) {
    try {
      attachments = JSON.parse(c.attachments);
    } catch {
      attachments = [];
    }
  }

  return {
    id: c.id,
    task_id: c.issue_id,
    author: c.author,
    content: c.content,
    created_at: isoToUnix(c.created_at),
    mentions: [],
    replies: [],
    attachments,
  };
}

// --- Blocked-by helpers ---

export function parseBlockedBy(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * Batch-compute which blocker IDs are still open.
 * Returns a Set of task IDs that are NOT closed (i.e. still blocking).
 */
export function getOpenBlockerIds(blockerIds: string[]): Set<string> {
  if (blockerIds.length === 0) return new Set();
  const db = getCCDatabase();
  const placeholders = blockerIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id FROM issues WHERE id IN (${placeholders}) AND status != 'closed'`
  ).all(...blockerIds) as { id: string }[];
  return new Set(rows.map(r => r.id));
}

/**
 * Get blocker details (id, title, status) for a set of blocker IDs.
 */
export function getBlockerDetails(blockerIds: string[]): Array<{ id: string; title: string; status: string }> {
  if (blockerIds.length === 0) return [];
  const db = getCCDatabase();
  const placeholders = blockerIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT id, title, status FROM issues WHERE id IN (${placeholders})`
  ).all(...blockerIds) as Array<{ id: string; title: string; status: string }>;
}

// --- Exports for priority mapping (used by API routes) ---

export { PRIORITY_FROM_MC };

// --- Tweet types ---

export type TweetRating = 'fire' | 'meh' | 'noise';

export interface CCTweet {
  id: string;
  title: string;
  author: string;
  theme: string;
  verdict: string;
  action: string;
  source: string;
  tweet_link: string;
  digest: string;
  content: string;
  created_at: string;
  scraped_at: string;
  pinned: number; // SQLite boolean
  media_urls: string;
  triage_status: string;
  snooze_until: string | null;
  rating: TweetRating | null; // joined from tweet_ratings
}

export interface TweetFilters {
  theme?: string;
  rating?: string;
  verdict?: string;
  digest?: string;
  pinned?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// --- Tweet query functions ---

export function getTweets(filters?: TweetFilters): { tweets: CCTweet[]; total: number; themes: string[]; digests: string[] } {
  const db = getCCDatabase();

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.theme) {
    conditions.push('t.theme = ?');
    params.push(filters.theme);
  }
  if (filters?.digest) {
    conditions.push('t.digest = ?');
    params.push(filters.digest);
  }
  if (filters?.pinned) {
    conditions.push('t.pinned = 1');
  }
  if (filters?.search) {
    conditions.push('(t.content LIKE ? OR t.title LIKE ? OR t.author LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }
  if (filters?.rating) {
    if (filters.rating === 'unrated') {
      conditions.push('r.rating IS NULL');
    } else {
      conditions.push('r.rating = ?');
      params.push(filters.rating);
    }
  }
  if (filters?.verdict) {
    if (filters.verdict === 'curated') {
      conditions.push("t.verdict IN ('keep', 'kept')");
    } else {
      conditions.push('t.verdict = ?');
      params.push(filters.verdict);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM tweets t
    LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
    ${where}
  `).get(...params) as { total: number };

  const tweets = db.prepare(`
    SELECT t.*, r.rating FROM tweets t
    LEFT JOIN tweet_ratings r ON t.id = r.tweet_id
    ${where}
    ORDER BY t.pinned DESC, t.scraped_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as CCTweet[];

  // Get distinct themes and digests for filter dropdowns
  const themes = (db.prepare(
    "SELECT DISTINCT theme FROM tweets WHERE theme IS NOT NULL AND theme != '' ORDER BY theme"
  ).all() as { theme: string }[]).map(r => r.theme);

  const digests = (db.prepare(
    "SELECT DISTINCT digest FROM tweets WHERE digest IS NOT NULL AND digest != '' ORDER BY digest DESC"
  ).all() as { digest: string }[]).map(r => r.digest);

  return { tweets, total: countRow.total, themes, digests };
}

export function rateTweet(id: string, rating: TweetRating | null): void {
  const writeDb = getCCDatabaseWrite();
  try {
    if (rating === null) {
      writeDb.prepare('DELETE FROM tweet_ratings WHERE tweet_id = ?').run(id);
    } else {
      writeDb.prepare(`
        INSERT INTO tweet_ratings (tweet_id, rating, rated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(tweet_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at
      `).run(id, rating);
    }
  } finally {
    writeDb.close();
  }
}

export function pinTweet(id: string, pinned: boolean): void {
  const writeDb = getCCDatabaseWrite();
  try {
    writeDb.prepare('UPDATE tweets SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  } finally {
    writeDb.close();
  }
}

export function triageUpdate(id: string, triageStatus: string): void {
  const writeDb = getCCDatabaseWrite();
  try {
    writeDb.prepare('UPDATE tweets SET triage_status = ? WHERE id = ?').run(triageStatus, id);
  } finally {
    writeDb.close();
  }
}

export function getTweetStats(): { by_theme: Record<string, number>; by_rating: Record<string, number>; by_digest: Record<string, number>; total: number } {
  const db = getCCDatabase();

  const total = (db.prepare('SELECT COUNT(*) as c FROM tweets').get() as { c: number }).c;

  const themeRows = db.prepare(
    "SELECT theme, COUNT(*) as c FROM tweets WHERE theme IS NOT NULL AND theme != '' GROUP BY theme"
  ).all() as { theme: string; c: number }[];
  const by_theme: Record<string, number> = {};
  for (const r of themeRows) by_theme[r.theme] = r.c;

  const ratingRows = db.prepare(
    "SELECT r.rating, COUNT(*) as c FROM tweet_ratings r GROUP BY r.rating"
  ).all() as { rating: string; c: number }[];
  const by_rating: Record<string, number> = {};
  for (const r of ratingRows) by_rating[r.rating] = r.c;

  const digestRows = db.prepare(
    "SELECT digest, COUNT(*) as c FROM tweets WHERE digest IS NOT NULL AND digest != '' GROUP BY digest ORDER BY digest DESC LIMIT 20"
  ).all() as { digest: string; c: number }[];
  const by_digest: Record<string, number> = {};
  for (const r of digestRows) by_digest[r.digest] = r.c;

  return { total, by_theme, by_rating, by_digest };
}

// --- Garden types ---

export interface CCGardenItem {
  id: string;
  content: string;
  type: string;
  interest: string;
  temporal: string;
  tags: string;        // JSON array
  note: string;
  original_source: string | null;
  media_urls: string;  // JSON array
  metadata: string;    // JSON blob
  enriched: number;
  instance_type: string;
  snooze_until: string | null;
  expires_at: string | null;
  created_at: string;
  saved_at: string;
}

export interface GardenFilters {
  interest?: string;
  type?: string;
  temporal?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface GardenStatsResult {
  byInterest: Record<string, number>;
  byType: Record<string, number>;
  total: number;
}

// --- Garden query functions ---

export function getGardenItems(filters?: GardenFilters): { items: CCGardenItem[]; total: number } {
  const db = getCCDatabase();

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.interest) {
    conditions.push('interest = ?');
    params.push(filters.interest);
  }
  if (filters?.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters?.temporal) {
    conditions.push('temporal = ?');
    params.push(filters.temporal);
  }
  if (filters?.search) {
    conditions.push('(content LIKE ? OR note LIKE ? OR tags LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM garden ${where}`).get(...params) as { total: number };

  const items = db.prepare(`
    SELECT * FROM garden ${where}
    ORDER BY saved_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as CCGardenItem[];

  return { items, total: countRow.total };
}

export function getGardenItem(id: string): CCGardenItem | undefined {
  const db = getCCDatabase();
  return db.prepare('SELECT * FROM garden WHERE id = ?').get(id) as CCGardenItem | undefined;
}

export function updateGardenItem(id: string, fields: Partial<Pick<CCGardenItem, 'content' | 'interest' | 'type' | 'temporal' | 'tags' | 'note' | 'original_source' | 'instance_type'>>): void {
  const writeDb = getCCDatabaseWrite();
  try {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (sets.length === 0) return;
    params.push(id);

    writeDb.prepare(`UPDATE garden SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } finally {
    writeDb.close();
  }
}

export function deleteGardenItem(id: string): void {
  const writeDb = getCCDatabaseWrite();
  try {
    writeDb.prepare('DELETE FROM garden WHERE id = ?').run(id);
  } finally {
    writeDb.close();
  }
}

export function getGardenStats(): GardenStatsResult {
  const db = getCCDatabase();

  const total = (db.prepare('SELECT COUNT(*) as c FROM garden').get() as { c: number }).c;

  const interestRows = db.prepare(
    "SELECT interest, COUNT(*) as c FROM garden WHERE interest IS NOT NULL AND interest != '' GROUP BY interest"
  ).all() as { interest: string; c: number }[];
  const byInterest: Record<string, number> = {};
  for (const r of interestRows) byInterest[r.interest] = r.c;

  const typeRows = db.prepare(
    "SELECT type, COUNT(*) as c FROM garden WHERE type IS NOT NULL AND type != '' GROUP BY type"
  ).all() as { type: string; c: number }[];
  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.type] = r.c;

  return { total, byInterest, byType };
}

// --- Inbox aggregation ---

export type InboxSourceType = 'task' | 'garden' | 'xfeed' | 'notification'

export interface InboxItem {
  id: string
  source: InboxSourceType
  title: string
  subtitle: string
  icon: string
  badge: string
  badgeColor: string
  timestamp: number // unix ms
  actionUrl?: string
  metadata: Record<string, any>
}

export interface InboxCounts {
  task: number
  garden: number
  xfeed: number
  notification: number
}

export function getInboxCounts(): InboxCounts {
  const db = getCCDatabase()

  const taskCount = (db.prepare(
    `SELECT COUNT(*) as c FROM issues WHERE status = 'draft' AND archived = 0`
  ).get() as { c: number }).c

  const gardenCount = (db.prepare(
    `SELECT COUNT(*) as c FROM garden WHERE temporal = 'now'`
  ).get() as { c: number }).c

  const xfeedCount = (db.prepare(
    `SELECT COUNT(*) as c FROM tweets t LEFT JOIN tweet_ratings r ON t.id = r.tweet_id WHERE r.tweet_id IS NULL AND t.triage_status = 'pending'`
  ).get() as { c: number }).c

  // Notifications come from MC's own db — caller handles that
  return { task: taskCount, garden: gardenCount, xfeed: xfeedCount, notification: 0 }
}

export function getInboxItems(source?: InboxSourceType, limit = 50): InboxItem[] {
  const items: InboxItem[] = []
  const db = getCCDatabase()

  // Tasks: drafts needing attention
  if (!source || source === 'task') {
    const tasks = db.prepare(
      `SELECT * FROM issues WHERE status = 'draft' AND archived = 0 ORDER BY updated_at DESC LIMIT ?`
    ).all(limit) as CCIssue[]

    for (const t of tasks) {
      const badge = deriveBadge(t.status, t.creator || '');
      items.push({
        id: `task-${t.id}`,
        source: 'task',
        title: t.title,
        subtitle: badge === 'proposal' ? 'Agent proposal — needs review' : 'Draft — needs shaping',
        icon: badge === 'proposal' ? '📋' : '💡',
        badge: badge || 'draft',
        badgeColor: badge === 'proposal' ? 'blue' : 'amber',
        timestamp: new Date(t.updated_at).getTime(),
        actionUrl: `tasks?id=${t.id}`,
        metadata: {
          status: t.status,
          assignee: t.assignee,
          priority: t.priority,
          project_id: t.project_id,
        },
      })
    }
  }

  // Garden: temporal = 'now'
  if (!source || source === 'garden') {
    const gardenItems = db.prepare(
      `SELECT * FROM garden WHERE temporal = 'now' ORDER BY saved_at DESC LIMIT ?`
    ).all(limit) as CCGardenItem[]

    for (const g of gardenItems) {
      items.push({
        id: `garden-${g.id}`,
        source: 'garden',
        title: g.content.slice(0, 120),
        subtitle: g.note || g.type || 'Check out now',
        icon: '🌱',
        badge: g.interest || g.type || 'now',
        badgeColor: 'emerald',
        timestamp: new Date(g.saved_at || g.created_at).getTime(),
        actionUrl: 'garden',
        metadata: {
          interest: g.interest,
          type: g.type,
          temporal: g.temporal,
        },
      })
    }
  }

  // X Feed: single summary card with count
  if (!source || source === 'xfeed') {
    const xfeedCount = (db.prepare(
      `SELECT COUNT(*) as c FROM tweets t LEFT JOIN tweet_ratings r ON t.id = r.tweet_id WHERE r.tweet_id IS NULL AND t.triage_status = 'pending'`
    ).get() as { c: number }).c

    if (xfeedCount > 0) {
      items.push({
        id: 'xfeed-summary',
        source: 'xfeed',
        title: `${xfeedCount} unrated tweet${xfeedCount === 1 ? '' : 's'}`,
        subtitle: 'Click to open X Feed panel',
        icon: '📡',
        badge: `${xfeedCount} pending`,
        badgeColor: 'purple',
        timestamp: Date.now(),
        actionUrl: 'xfeed',
        metadata: { count: xfeedCount },
      })
    }
  }

  // Sort by timestamp DESC
  items.sort((a, b) => b.timestamp - a.timestamp)

  return items.slice(0, limit)
}

// --- Project CRUD Operations ---

/**
 * Create a new project in control-center.db
 */
export function createProject(
  title: string,
  description: string,
  emoji: string,
  repo_url?: string,
  local_path?: string
): CCProject {
  const db = getCCDatabaseWrite();
  try {
    const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, title, description, emoji, created_at, updated_at, archived, schedule, repo_url, local_path)
      VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?)
    `).run(id, title, description || '', emoji || '📁', now, now, repo_url || '', local_path || '');

    logger.info({ projectId: id, title }, 'Created project');

    return {
      id,
      title,
      description: description || '',
      emoji: emoji || '📁',
      created_at: now,
      updated_at: now,
      archived: 0,
      schedule: '',
      repo_url: repo_url || '',
      local_path: local_path || '',
    };
  } finally {
    db.close();
  }
}

/**
 * Update a project's fields
 */
export function updateProject(id: string, fields: Partial<Pick<CCProject, 'title' | 'description' | 'emoji' | 'repo_url' | 'local_path'>>): void {
  const db = getCCDatabaseWrite();
  try {
    const updates: string[] = [];
    const values: any[] = [];

    if (fields.title !== undefined) {
      updates.push('title = ?');
      values.push(fields.title);
    }
    if (fields.description !== undefined) {
      updates.push('description = ?');
      values.push(fields.description);
    }
    if (fields.emoji !== undefined) {
      updates.push('emoji = ?');
      values.push(fields.emoji);
    }
    if (fields.repo_url !== undefined) {
      updates.push('repo_url = ?');
      values.push(fields.repo_url);
    }
    if (fields.local_path !== undefined) {
      updates.push('local_path = ?');
      values.push(fields.local_path);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const sql = `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);

    logger.info({ projectId: id, fields }, 'Updated project');
  } finally {
    db.close();
  }
}

/**
 * Archive a project (soft delete)
 */
export function archiveProject(id: string): void {
  const db = getCCDatabaseWrite();
  try {
    db.prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    logger.info({ projectId: id }, 'Archived project');
  } finally {
    db.close();
  }
}

/**
 * Get count of non-archived tasks for a project
 */
export function getProjectTaskCount(projectId: string): number {
  const db = getCCDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND archived = 0')
    .get(projectId) as { count: number };
  return result.count;
}

/**
 * Get the most recent task activity timestamp for a project
 * Returns unix timestamp in milliseconds, or 0 if no tasks
 */
export function getProjectLastActivity(projectId: string): number {
  const db = getCCDatabase();
  const result = db.prepare('SELECT MAX(updated_at) as last_updated FROM issues WHERE project_id = ? AND archived = 0')
    .get(projectId) as { last_updated: string | null };

  if (!result.last_updated) return 0;

  return isoToUnix(result.last_updated);
}

// Cleanup
function closeCCDatabase() {
  if (ccDb) {
    ccDb.close();
    ccDb = null;
  }
}

process.on('exit', closeCCDatabase);
process.on('SIGINT', closeCCDatabase);
process.on('SIGTERM', closeCCDatabase);
