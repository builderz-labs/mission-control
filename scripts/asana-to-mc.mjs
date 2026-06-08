#!/usr/bin/env node
// Asana → Mission Control one-way migration
// Usage:
//   node scripts/asana-to-mc.mjs --dry-run        (prints, does not write)
//   node scripts/asana-to-mc.mjs                  (writes for real)
//   node scripts/asana-to-mc.mjs --limit 10       (cap total tasks created)
//   node scripts/asana-to-mc.mjs --mc-url http://204.168.227.30:4000
//
// Reads Asana PAT from ~/james/.env (variable ASANA_PAT).
// Mission Control PROD key is read from HETZNER_PRODUCTION.md by default — pass --mc-key to override.
//
// Safety:
//   - Idempotent. Re-runs skip any Asana GID already imported (matched on `asana:<gid>` tag).
//   - Throttled to 5 req/sec to MC.
//   - One-way only — does NOT mutate Asana.
//   - Default to dry-run if --confirm is not passed AND --dry-run not passed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || process.env.USERPROFILE;

// ─── CLI flags ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const flagVal = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DRY_RUN = flag('--dry-run');
const CONFIRM = flag('--confirm');
const LIMIT = Number(flagVal('--limit', '0')) || 0; // 0 = unlimited
const MC_URL = flagVal('--mc-url', 'http://204.168.227.30:4000');
const MC_KEY_CLI = flagVal('--mc-key', '');

if (!DRY_RUN && !CONFIRM) {
  console.error('REFUSING TO RUN: pass --dry-run for preview, or --confirm to write to MC');
  process.exit(2);
}

// ─── Constants ───────────────────────────────────────────────────────────
const ASANA_WORKSPACE = '1203637576513591';
const ASANA_USER_ME = 'me';

const KEY_PROJECTS = {
  current_projects: '1203645122171598',
  day_to_day_va: '1203640178185218',
  operations_calendar: '1205194277777788',
};

// MC agent names (lowercased) used for assignee mapping
const MC_AGENTS = new Set([
  'sofia','james','leo','victoria','aria','marcus','atlas','edward',
  'cleo','iris','larry','nina','nathan','hugo','isabel',
]);

// Asana human → MC tag mapping for non-agent assignees we know
// (purely additive — anything not in here lands as tag `human:<slug>`)
const KNOWN_HUMANS = {
  'gerda micke': 'gerda',
  'arianne': 'arianne',
  'hanna': 'hanna',
  'jose': 'jose',
  'kris': 'kris',
  'lukasz': 'lukasz',
};

// ─── Helpers ─────────────────────────────────────────────────────────────
function readEnvFile(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  const txt = fs.readFileSync(filePath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return null;
}

function readMCKey() {
  if (MC_KEY_CLI) return MC_KEY_CLI;
  const md = path.join(__dirname, '..', 'HETZNER_PRODUCTION.md');
  if (!fs.existsSync(md)) return null;
  const txt = fs.readFileSync(md, 'utf8');
  // line in the table looks like: | API key (x-api-key header) | `<hex>` |
  const m = txt.match(/x-api-key[^`]*`([a-f0-9]{32,})`/i);
  return m ? m[1] : null;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function diffDaysFromNow(isoDate) {
  if (!isoDate) return null;
  const due = new Date(isoDate + 'T23:59:59Z').getTime();
  const now = Date.now();
  return Math.floor((due - now) / (1000 * 60 * 60 * 24));
}

function mapPriority(dueOn) {
  const d = diffDaysFromNow(dueOn);
  if (d === null) return 'low';
  if (d < 0) return 'critical';
  if (d <= 3) return 'high';
  if (d <= 14) return 'medium';
  return 'low';
}

function mapAssignee(name) {
  if (!name) return { assigned_to: null, extraTags: [] };
  const lower = String(name).toLowerCase().trim();
  for (const agent of MC_AGENTS) {
    if (lower === agent || lower.includes(agent)) {
      return { assigned_to: agent, extraTags: [] };
    }
  }
  const known = KNOWN_HUMANS[lower];
  return {
    assigned_to: null,
    extraTags: [`human:${known || slugify(name)}`],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP wrappers ───────────────────────────────────────────────────────
async function asanaGET(endpoint, token, params = {}) {
  const url = new URL(`https://app.asana.com/api/1.0${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana ${res.status} on ${endpoint}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function asanaPaginate(endpoint, token, params = {}) {
  const all = [];
  let offset = undefined;
  do {
    const data = await asanaGET(endpoint, token, { ...params, limit: 100, offset });
    if (data.data) all.push(...data.data);
    offset = data.next_page?.offset;
  } while (offset);
  return all;
}

async function mcGET(endpoint, key) {
  const res = await fetch(`${MC_URL}${endpoint}`, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MC GET ${res.status} on ${endpoint}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function mcPOST(endpoint, key, body) {
  const res = await fetch(`${MC_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MC POST ${res.status} on ${endpoint}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Fetch ALL existing MC tasks (paginated) and build a Set of imported Asana GIDs
async function loadExistingAsanaGids(key) {
  const existing = new Set();
  const limit = 200;
  let offset = 0;
  for (;;) {
    const data = await mcGET(`/api/tasks?limit=${limit}&offset=${offset}`, key);
    const tasks = data.tasks || [];
    for (const t of tasks) {
      const tags = Array.isArray(t.tags) ? t.tags : [];
      for (const tag of tags) {
        const m = String(tag).match(/^asana:(\d+)$/);
        if (m) existing.add(m[1]);
      }
    }
    if (tasks.length < limit) break;
    offset += tasks.length;
    if (offset > 5000) break; // hard guard
  }
  return existing;
}

// ─── Fetch from Asana ────────────────────────────────────────────────────
async function fetchAsanaTasks(token) {
  const optFields = [
    'name', 'notes', 'completed', 'due_on', 'due_at',
    'assignee.name', 'assignee.gid',
    'projects.name', 'projects.gid',
    'permalink_url', 'modified_at', 'created_at',
    'memberships.project.name', 'memberships.section.name',
  ].join(',');

  // 1. My tasks (incomplete)
  const myTasks = await asanaPaginate('/tasks', token, {
    assignee: ASANA_USER_ME,
    workspace: ASANA_WORKSPACE,
    completed_since: 'now',
    opt_fields: optFields,
  });

  // 2. Tasks in each key project (incomplete)
  const byProject = {};
  for (const [label, gid] of Object.entries(KEY_PROJECTS)) {
    try {
      byProject[label] = await asanaPaginate(`/projects/${gid}/tasks`, token, {
        completed_since: 'now',
        opt_fields: optFields,
      });
    } catch (e) {
      console.error(`  WARN: failed to fetch project ${label} (${gid}): ${e.message}`);
      byProject[label] = [];
    }
  }

  // Merge, dedupe by gid
  const all = new Map();
  for (const t of myTasks) all.set(t.gid, { ...t, _source: ['my-tasks'] });
  for (const [label, list] of Object.entries(byProject)) {
    for (const t of list) {
      if (all.has(t.gid)) all.get(t.gid)._source.push(label);
      else all.set(t.gid, { ...t, _source: [label] });
    }
  }

  // Drop completed defensively (assignee `/tasks` includes recently completed despite completed_since=now sometimes)
  return [...all.values()].filter((t) => !t.completed);
}

// ─── Transform → MC task body ────────────────────────────────────────────
function toMCTask(asanaTask) {
  const { name, notes, due_on, assignee, projects, permalink_url, _source } = asanaTask;
  const { assigned_to, extraTags } = mapAssignee(assignee?.name);
  const priority = mapPriority(due_on);

  const projectNames = (projects || []).map((p) => p.name).filter(Boolean);
  const descParts = [];
  if (notes) descParts.push(notes.trim());
  descParts.push('---');
  descParts.push(`Source: Asana (migrated ${new Date().toISOString().slice(0, 10)})`);
  if (permalink_url) descParts.push(`Asana link: ${permalink_url}`);
  if (assignee?.name) descParts.push(`Original assignee: ${assignee.name}`);
  if (projectNames.length) descParts.push(`Projects: ${projectNames.join(' · ')}`);
  if (due_on) descParts.push(`Due: ${due_on}`);
  if (_source) descParts.push(`Pulled from: ${_source.join(', ')}`);

  const tags = [
    'asana-migration',
    `asana:${asanaTask.gid}`,
    ...extraTags,
    ...projectNames.slice(0, 3).map((p) => `project:${slugify(p)}`),
  ];

  const body = {
    title: (name || '(untitled)').slice(0, 500),
    description: descParts.join('\n').slice(0, 5000),
    status: 'inbox',
    priority,
    tags,
    metadata: {
      asana_gid: asanaTask.gid,
      asana_url: permalink_url || null,
      asana_assignee: assignee?.name || null,
      asana_due_on: due_on || null,
      migrated_at: new Date().toISOString(),
    },
  };
  if (assigned_to) body.assigned_to = assigned_to;
  if (due_on) body.due_date = due_on;
  return body;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Asana → Mission Control migration`);
  console.log(`  Mode:   ${DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE (real import)'}`);
  console.log(`  MC URL: ${MC_URL}`);
  if (LIMIT) console.log(`  Limit:  ${LIMIT} tasks`);
  console.log('');

  const asanaToken = readEnvFile(path.join(HOME, 'james', '.env'), 'ASANA_PAT');
  if (!asanaToken) {
    console.error('FATAL: ASANA_PAT not found in ~/james/.env');
    process.exit(1);
  }
  const mcKey = readMCKey();
  if (!mcKey) {
    console.error('FATAL: MC API key not found (pass --mc-key or set HETZNER_PRODUCTION.md)');
    process.exit(1);
  }

  // Fetch existing MC tasks for idempotency
  console.log('→ Loading existing MC tasks to check for already-imported GIDs...');
  let existing = new Set();
  try {
    existing = await loadExistingAsanaGids(mcKey);
    console.log(`  Already imported: ${existing.size} Asana GIDs found in MC`);
  } catch (e) {
    console.error(`  WARN: could not load existing MC tasks (${e.message}). Proceeding without idempotency check — could create duplicates.`);
    if (!DRY_RUN) {
      console.error('  Aborting real run for safety. Use --dry-run to preview anyway.');
      process.exit(1);
    }
  }

  // Fetch Asana
  console.log('→ Fetching open Asana tasks (my-tasks + key projects)...');
  const tasks = await fetchAsanaTasks(asanaToken);
  console.log(`  Found ${tasks.length} incomplete tasks across sources`);

  // Filter to new only
  const toCreate = tasks.filter((t) => !existing.has(t.gid));
  console.log(`  New (not yet in MC): ${toCreate.length}`);
  console.log(`  Already in MC (skip): ${tasks.length - toCreate.length}`);

  // Apply limit
  const slice = LIMIT > 0 ? toCreate.slice(0, LIMIT) : toCreate;
  if (LIMIT && toCreate.length > LIMIT) {
    console.log(`  Limited to first ${LIMIT} tasks`);
  }

  // Bucketing for receipt
  const stats = { critical: 0, high: 0, medium: 0, low: 0, byAgent: {}, unassigned: 0 };

  console.log('');
  console.log(`→ ${DRY_RUN ? 'Would create' : 'Creating'} ${slice.length} MC tasks (5 req/sec)...`);
  console.log('');

  const created = [];
  const failed = [];
  let i = 0;
  for (const at of slice) {
    i++;
    const body = toMCTask(at);
    stats[body.priority]++;
    if (body.assigned_to) {
      stats.byAgent[body.assigned_to] = (stats.byAgent[body.assigned_to] || 0) + 1;
    } else {
      stats.unassigned++;
    }

    if (DRY_RUN) {
      if (i <= 5) {
        // Print first 5 in full for sample
        console.log(`[${i}] ${body.priority.toUpperCase().padEnd(8)} ${body.assigned_to || '(unassigned)'}  ${body.title}`);
        console.log(`     asana:${at.gid}  tags=[${body.tags.join(', ')}]`);
        if (at.due_on) console.log(`     due=${at.due_on}`);
        console.log('');
      } else if (i === 6) {
        console.log(`... (${slice.length - 5} more, suppressed)`);
      }
      continue;
    }

    // Real write — throttle to 5 req/sec (200ms between requests)
    try {
      const resp = await mcPOST('/api/tasks', mcKey, body);
      created.push({ asana_gid: at.gid, mc_id: resp.task?.id, title: body.title });
      if (i % 10 === 0) console.log(`  ... ${i}/${slice.length} created`);
    } catch (e) {
      failed.push({ asana_gid: at.gid, title: body.title, error: e.message });
      console.error(`  FAIL [${at.gid}] ${body.title.slice(0, 60)}: ${e.message}`);
    }
    await sleep(210); // 5 req/sec ceiling
  }

  // Summary
  console.log('');
  console.log('─── Summary ───────────────────────────────');
  console.log(`Tasks ${DRY_RUN ? 'that would be created' : 'created'}: ${DRY_RUN ? slice.length : created.length}`);
  if (!DRY_RUN) console.log(`Failed: ${failed.length}`);
  console.log(`By priority: critical=${stats.critical}, high=${stats.high}, medium=${stats.medium}, low=${stats.low}`);
  console.log(`Unassigned (human-tagged): ${stats.unassigned}`);
  console.log(`By MC agent:`);
  for (const [a, n] of Object.entries(stats.byAgent).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${a.padEnd(10)} ${n}`);
  }

  // Receipts file
  if (!DRY_RUN && created.length > 0) {
    const receiptPath = path.join(__dirname, '..', `.data`, `asana-migration-${new Date().toISOString().slice(0, 10)}.json`);
    try {
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      fs.writeFileSync(receiptPath, JSON.stringify({ created, failed, stats, timestamp: new Date().toISOString() }, null, 2));
      console.log(`Receipts written: ${receiptPath}`);
    } catch (e) {
      console.error(`WARN: could not write receipts file (${e.message})`);
    }
  }

  if (!DRY_RUN && failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
