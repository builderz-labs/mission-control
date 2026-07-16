#!/usr/bin/env node
/*
 Mission Control CLI (v2)
 - Zero heavy dependencies
 - API-key first for agent automation
 - JSON mode + stable exit codes
 - Lazy command resolution (no eager required() calls)
 - SSE streaming for events watch
*/

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeMissionControlBaseUrl } = require('./mc-base-url.cjs');

const EXIT = {
  OK: 0,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NETWORK: 5,
  SERVER: 6,
};

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out.flags[key] = true;
      continue;
    }
    out.flags[key] = next;
    i += 1;
  }
  return out;
}

function usage() {
  console.log(`Mission Control CLI

Usage:
  mc <group> <action> [--flags]

Groups:
  auth         login/logout/whoami
  agents       list/get/create/update/delete/wake/diagnostics/heartbeat
               memory get|set|clear / soul get|set|templates / attribution
  tasks        list/get/create/update/delete/queue
               comments list|add / broadcast
  sessions     list/control/continue/transcript
  connect      register/list/disconnect
  tokens       list/stats/by-agent/agent-costs/task-costs/export/rotate
  skills       list/content/upsert/delete/check
  cron         list/create/update/pause/resume/remove/run
  events       watch
  status       health/overview/dashboard/gateway/models/capabilities
  export       audit/tasks/activities/pipelines
  raw          request fallback

Common flags:
  --profile <name>      profile name (default: default)
  --url <base_url>      override profile URL
  --api-key <key>       override profile API key
  --json                JSON output
  --timeout-ms <n>      request timeout (default 20000)
  --help                show help

Examples:
  mc agents list --json
  mc agents memory get --id 5
  mc agents soul set --id 5 --template operator
  mc tasks queue --agent Aegis --max-capacity 2
  mc tasks comments list --id 42
  mc tasks comments add --id 42 --content "Looks good"
  mc sessions transcript --kind claude-code --id abc123
  mc tokens agent-costs --timeframe week
  mc tokens export --format csv
  mc status health
  mc events watch --types agent,task
  mc raw --method GET --path /api/status --json
`);
}

function profilePath(name) {
  return path.join(os.homedir(), '.mission-control', 'profiles', `${name}.json`);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadProfile(name) {
  const p = profilePath(name);
  if (!fs.existsSync(p)) {
    return {
      name,
      url: process.env.MC_URL || 'http://127.0.0.1:3000',
      apiKey: process.env.MC_API_KEY || '',
      cookie: process.env.MC_COOKIE || '',
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      name,
      url: parsed.url || process.env.MC_URL || 'http://127.0.0.1:3000',
      apiKey: parsed.apiKey || process.env.MC_API_KEY || '',
      cookie: parsed.cookie || process.env.MC_COOKIE || '',
    };
  } catch {
    return {
      name,
      url: process.env.MC_URL || 'http://127.0.0.1:3000',
      apiKey: process.env.MC_API_KEY || '',
      cookie: process.env.MC_COOKIE || '',
    };
  }
}

function saveProfile(profile) {
  const p = profilePath(profile.name);
  ensureParentDir(p);
  fs.writeFileSync(p, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
}

function mapStatusToExit(status) {
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.FORBIDDEN;
  if (status >= 500) return EXIT.SERVER;
  return EXIT.USAGE;
}

function required(flags, key) {
  const value = flags[key];
  if (value === undefined || value === true || String(value).trim() === '') {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function optional(flags, key, fallback) {
  const value = flags[key];
  if (value === undefined || value === true) return fallback;
  return String(value);
}

function bodyFromFlags(flags) {
  if (flags.body) return JSON.parse(String(flags.body));
  return undefined;
}

async function httpRequest({ baseUrl, apiKey, cookie, method, route, body, timeoutMs = 20000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (cookie) headers['Cookie'] = cookie;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const url = `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      setCookie: res.headers.get('set-cookie') || '',
      url,
      method,
    };
  } catch (err) {
    clearTimeout(timer);
    if (String(err?.name || '') === 'AbortError') {
      return { ok: false, status: 0, data: { error: `Request timeout after ${timeoutMs}ms` }, timeout: true, url, method };
    }
    return { ok: false, status: 0, data: { error: err?.message || 'Network error' }, network: true, url, method };
  }
}

async function sseStream({ baseUrl, apiKey, cookie, route, timeoutMs, onEvent, onError }) {
  const headers = { Accept: 'text/event-stream' };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (cookie) headers['Cookie'] = cookie;
  const url = `${baseUrl}${route}`;

  const controller = new AbortController();
  let timer;
  if (timeoutMs && timeoutMs < Infinity) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = () => { controller.abort(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      onError({ status: res.status, data: text });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          currentData += line.slice(6);
        } else if (line === '' && currentData) {
          try {
            const event = JSON.parse(currentData);
            onEvent(event);
          } catch {
            // Non-JSON data line, emit raw
            onEvent({ raw: currentData });
          }
          currentData = '';
        }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // clean shutdown
    onError({ error: err?.message || 'SSE connection error' });
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.ok) {
    console.log(`OK ${result.status} ${result.method} ${result.url}`);
    if (result.data && Object.keys(result.data).length > 0) {
      console.log(JSON.stringify(result.data, null, 2));
    }
    return;
  }
  console.error(`ERROR ${result.status || 'NETWORK'} ${result.method} ${result.url}`);
  console.error(JSON.stringify(result.data, null, 2));
}

// --- Command handlers ---
// Each returns { method, route, body? } or handles the request directly and returns null.

const commands = {
  auth: {
    async login(flags, ctx) {
      const username = required(flags, 'username');
      const password = required(flags, 'password');
      const result = await httpRequest({
        baseUrl: ctx.baseUrl,
        method: 'POST',
        route: '/api/auth/login',
        body: { username, password },
        timeoutMs: ctx.timeoutMs,
      });
      if (result.ok && result.setCookie) {
        ctx.profile.url = ctx.baseUrl;
        ctx.profile.cookie = result.setCookie.split(';')[0];
        if (ctx.apiKey) ctx.profile.apiKey = ctx.apiKey;
        saveProfile(ctx.profile);
        result.data = { ...result.data, profile: ctx.profile.name, saved_cookie: true };
      }
      return result;
    },
    async logout(flags, ctx) {
      const result = await httpRequest({ baseUrl: ctx.baseUrl, apiKey: ctx.apiKey, cookie: ctx.profile.cookie, method: 'POST', route: '/api/auth/logout', timeoutMs: ctx.timeoutMs });
      if (result.ok) {
        ctx.profile.cookie = '';
        saveProfile(ctx.profile);
      }
      return result;
    },
    whoami: () => ({ method: 'GET', route: '/api/auth/me' }),
  },

  agents: {
    list: () => ({ method: 'GET', route: '/api/agents' }),
    get: (flags) => ({ method: 'GET', route: `/api/agents/${required(flags, 'id')}` }),
    create: (flags) => ({
      method: 'POST',
      route: '/api/agents',
      body: bodyFromFlags(flags) || { name: required(flags, 'name'), role: required(flags, 'role') },
    }),
    update: (flags) => ({
      method: 'PUT',
      route: `/api/agents/${required(flags, 'id')}`,
      body: bodyFromFlags(flags) || {},
    }),
    delete: (flags) => ({ method: 'DELETE', route: `/api/agents/${required(flags, 'id')}` }),
    wake: (flags) => ({ method: 'POST', route: `/api/agents/${required(flags, 'id')}/wake` }),
    diagnostics: (flags) => ({ method: 'GET', route: `/api/agents/${required(flags, 'id')}/diagnostics` }),
    heartbeat: (flags) => ({ method: 'POST', route: `/api/agents/${required(flags, 'id')}/heartbeat` }),
    attribution: (flags) => {
      const id = required(flags, 'id');
      const hours = optional(flags, 'hours', '24');
      const section = optional(flags, 'section', undefined);
      let qs = `?hours=${encodeURIComponent(hours)}`;
      if (section) qs += `&section=${encodeURIComponent(section)}`;
      if (flags.privileged) qs += '&privileged=1';
      return { method: 'GET', route: `/api/agents/${id}/attribution${qs}` };
    },
    // Subcommand: agents memory get|set|clear --id <id>
    memory: (flags) => {
      const id = required(flags, 'id');
      const sub = flags._sub;
      if (sub === 'get' || !sub) return { method: 'GET', route: `/api/agents/${id}/memory` };
      if (sub === 'set') {
        const content = flags.content || flags.file
          ? fs.readFileSync(required(flags, 'file'), 'utf8')
          : required(flags, 'content');
        return {
          method: 'PUT',
          route: `/api/agents/${id}/memory`,
          body: { working_memory: content, append: Boolean(flags.append) },
        };
      }
      if (sub === 'clear') return { method: 'DELETE', route: `/api/agents/${id}/memory` };
      throw new Error(`Unknown agents memory subcommand: ${sub}. Use get|set|clear`);
    },
    // Subcommand: agents soul get|set|templates --id <id>
    soul: (flags) => {
      const id = required(flags, 'id');
      const sub = flags._sub;
      if (sub === 'get' || !sub) return { method: 'GET', route: `/api/agents/${id}/soul` };
      if (sub === 'set') {
        const body = {};
        if (flags.template) body.template_name = flags.template;
        else if (flags.file) body.soul_content = fs.readFileSync(String(flags.file), 'utf8');
        else body.soul_content = required(flags, 'content');
        return { method: 'PUT', route: `/api/agents/${id}/soul`, body };
      }
      if (sub === 'templates') {
        const template = optional(flags, 'template', undefined);
        const qs = template ? `?template=${encodeURIComponent(template)}` : '';
        return { method: 'PATCH', route: `/api/agents/${id}/soul${qs}` };
      }
      throw new Error(`Unknown agents soul subcommand: ${sub}. Use get|set|templates`);
    },
  },

  tasks: {
    list: () => ({ method: 'GET', route: '/api/tasks' }),
    get: (flags) => ({ method: 'GET', route: `/api/tasks/${required(flags, 'id')}` }),
    create: (flags) => ({
      method: 'POST',
      route: '/api/tasks',
      body: bodyFromFlags(flags) || { title: required(flags, 'title') },
    }),
    update: (flags) => ({
      method: 'PUT',
      route: `/api/tasks/${required(flags, 'id')}`,
      body: bodyFromFlags(flags) || {},
    }),
    delete: (flags) => ({ method: 'DELETE', route: `/api/tasks/${required(flags, 'id')}` }),
    queue: (flags) => {
      const agent = required(flags, 'agent');
      let qs = `?agent=${encodeURIComponent(agent)}`;
      if (flags['max-capacity']) qs += `&max_capacity=${encodeURIComponent(String(flags['max-capacity']))}`;
      return { method: 'GET', route: `/api/tasks/queue${qs}` };
    },
    broadcast: (flags) => ({
      method: 'POST',
      route: `/api/tasks/${required(flags, 'id')}/broadcast`,
      body: { message: required(flags, 'message') },
    }),
    // Subcommand: tasks comments list|add --id <id>
    comments: (flags) => {
      const id = required(flags, 'id');
      const sub = flags._sub;
      if (sub === 'list' || !sub) return { method: 'GET', route: `/api/tasks/${id}/comments` };
      if (sub === 'add') {
        const body = { content: required(flags, 'content') };
        if (flags['parent-id']) body.parent_id = Number(flags['parent-id']);
        return { method: 'POST', route: `/api/tasks/${id}/comments`, body };
      }
      throw new Error(`Unknown tasks comments subcommand: ${sub}. Use list|add`);
    },
  },

  sessions: {
    list: () => ({ method: 'GET', route: '/api/sessions' }),
    control: (flags) => ({
      method: 'POST',
      route: `/api/sessions/${required(flags, 'id')}/control`,
      body: { action: required(flags, 'action') },
    }),
    continue: (flags) => ({
      method: 'POST',
      route: '/api/sessions/continue',
      body: {
        kind: required(flags, 'kind'),
        id: required(flags, 'id'),
        prompt: required(flags, 'prompt'),
      },
    }),
    transcript: (flags) => {
      const kind = required(flags, 'kind');
      const id = required(flags, 'id');
      let qs = `?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      if (flags.source) qs += `&source=${encodeURIComponent(String(flags.source))}`;
      return { method: 'GET', route: `/api/sessions/transcript${qs}` };
    },
  },

  connect: {
    register: (flags) => ({
      method: 'POST',
      route: '/api/connect',
      body: bodyFromFlags(flags) || { tool_name: required(flags, 'tool-name'), agent_name: required(flags, 'agent-name') },
    }),
    list: () => ({ method: 'GET', route: '/api/connect' }),
    disconnect: (flags) => ({
      method: 'DELETE',
      route: '/api/connect',
      body: { connection_id: required(flags, 'connection-id') },
    }),
  },

  tokens: {
    list: (flags) => {
      let qs = '?action=list';
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    stats: (flags) => {
      let qs = '?action=stats';
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    'by-agent': (flags) => ({
      method: 'GET',
      route: `/api/tokens/by-agent?days=${encodeURIComponent(String(flags.days || '30'))}`,
    }),
    'agent-costs': (flags) => {
      let qs = '?action=agent-costs';
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    'task-costs': (flags) => {
      let qs = '?action=task-costs';
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    trends: (flags) => {
      let qs = '?action=trends';
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    export: (flags) => {
      const format = optional(flags, 'format', 'json');
      let qs = `?action=export&format=${encodeURIComponent(format)}`;
      if (flags.timeframe) qs += `&timeframe=${encodeURIComponent(String(flags.timeframe))}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      return { method: 'GET', route: `/api/tokens${qs}` };
    },
    rotate: (flags) => {
      if (flags.confirm) return { method: 'POST', route: '/api/tokens/rotate' };
      return { method: 'GET', route: '/api/tokens/rotate' };
    },
  },

  skills: {
    list: () => ({ method: 'GET', route: '/api/skills' }),
    content: (flags) => ({
      method: 'GET',
      route: `/api/skills?mode=content&source=${encodeURIComponent(required(flags, 'source'))}&name=${encodeURIComponent(required(flags, 'name'))}`,
    }),
    check: (flags) => ({
      method: 'GET',
      route: `/api/skills?mode=check&source=${encodeURIComponent(required(flags, 'source'))}&name=${encodeURIComponent(required(flags, 'name'))}`,
    }),
    upsert: (flags) => ({
      method: 'PUT',
      route: '/api/skills',
      body: {
        source: required(flags, 'source'),
        name: required(flags, 'name'),
        content: fs.readFileSync(required(flags, 'file'), 'utf8'),
      },
    }),
    delete: (flags) => ({
      method: 'DELETE',
      route: `/api/skills?source=${encodeURIComponent(required(flags, 'source'))}&name=${encodeURIComponent(required(flags, 'name'))}`,
    }),
  },

  cron: {
    list: () => ({ method: 'GET', route: '/api/cron' }),
    create: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
    update: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
    pause: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
    resume: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
    remove: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
    run: (flags) => ({ method: 'POST', route: '/api/cron', body: bodyFromFlags(flags) || {} }),
  },

  status: {
    health: () => ({ method: 'GET', route: '/api/status?action=health' }),
    overview: () => ({ method: 'GET', route: '/api/status?action=overview' }),
    dashboard: () => ({ method: 'GET', route: '/api/status?action=dashboard' }),
    gateway: () => ({ method: 'GET', route: '/api/status?action=gateway' }),
    models: () => ({ method: 'GET', route: '/api/status?action=models' }),
    capabilities: () => ({ method: 'GET', route: '/api/status?action=capabilities' }),
  },

  export: {
    audit: (flags) => {
      const format = optional(flags, 'format', 'json');
      let qs = `?type=audit&format=${encodeURIComponent(format)}`;
      if (flags.since) qs += `&since=${encodeURIComponent(String(flags.since))}`;
      if (flags.until) qs += `&until=${encodeURIComponent(String(flags.until))}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      return { method: 'GET', route: `/api/export${qs}` };
    },
    tasks: (flags) => {
      const format = optional(flags, 'format', 'json');
      let qs = `?type=tasks&format=${encodeURIComponent(format)}`;
      if (flags.since) qs += `&since=${encodeURIComponent(String(flags.since))}`;
      if (flags.until) qs += `&until=${encodeURIComponent(String(flags.until))}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      return { method: 'GET', route: `/api/export${qs}` };
    },
    activities: (flags) => {
      const format = optional(flags, 'format', 'json');
      let qs = `?type=activities&format=${encodeURIComponent(format)}`;
      if (flags.since) qs += `&since=${encodeURIComponent(String(flags.since))}`;
      if (flags.until) qs += `&until=${encodeURIComponent(String(flags.until))}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      return { method: 'GET', route: `/api/export${qs}` };
    },
    pipelines: (flags) => {
      const format = optional(flags, 'format', 'json');
      let qs = `?type=pipelines&format=${encodeURIComponent(format)}`;
      if (flags.since) qs += `&since=${encodeURIComponent(String(flags.since))}`;
      if (flags.until) qs += `&until=${encodeURIComponent(String(flags.until))}`;
      if (flags.limit) qs += `&limit=${encodeURIComponent(String(flags.limit))}`;
      return { method: 'GET', route: `/api/export${qs}` };
    },
  },
};

// --- Events watch (SSE streaming) ---

async function handleEventsWatch(flags, ctx) {
  const types = optional(flags, 'types', undefined);
  let route = '/api/events';
  if (types) route += `?types=${encodeURIComponent(types)}`;

  if (ctx.asJson) {
    // JSON mode: one JSON object per line (NDJSON)
    await sseStream({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      cookie: ctx.profile.cookie,
      route,
      timeoutMs: ctx.timeoutMs,
      onEvent: (event) => {
        if (event.type === 'heartbeat') return;
        console.log(JSON.stringify(event));
      },
      onError: (err) => {
        console.error(JSON.stringify({ ok: false, error: err }));
        process.exit(EXIT.SERVER);
      },
    });
  } else {
    console.log(`Watching events at ${normalizeBaseUrl(ctx.baseUrl)}${route}`);
    console.log('Press Ctrl+C to stop.\n');
    await sseStream({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      cookie: ctx.profile.cookie,
      route,
      timeoutMs: ctx.timeoutMs,
      onEvent: (event) => {
        if (event.type === 'heartbeat') return;
        const ts = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();
        const type = event.type || event.data?.mutation || 'event';
        console.log(`[${ts}] ${type}: ${JSON.stringify(event.data || event)}`);
      },
      onError: (err) => {
        console.error(`SSE error: ${JSON.stringify(err)}`);
        process.exit(EXIT.SERVER);
      },
    });
  }
  process.exit(EXIT.OK);
}

// --- Main ---

async function run() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.help || parsed._.length === 0) {
    usage();
    process.exit(EXIT.OK);
  }

  const asJson = Boolean(parsed.flags.json);
  const profileName = String(parsed.flags.profile || 'default');
  const profile = loadProfile(profileName);
  const baseUrlInput = parsed.flags.url ? String(parsed.flags.url) : profile.url;
  const apiKey = parsed.flags['api-key'] ? String(parsed.flags['api-key']) : profile.apiKey;
  const timeoutMs = Number(parsed.flags['timeout-ms'] || 20000);

  const group = parsed._[0];
  const action = parsed._[1];
  // For compound subcommands like: agents memory get / tasks comments add
  const sub = parsed._[2];

  try {
    const baseUrl = normalizeMissionControlBaseUrl(baseUrlInput);
    const ctx = { baseUrl, apiKey, profile, timeoutMs, asJson };
    // Raw passthrough
    if (group === 'raw') {
      const method = String(required(parsed.flags, 'method')).toUpperCase();
      const route = String(required(parsed.flags, 'path'));
      const body = bodyFromFlags(parsed.flags);
      const result = await httpRequest({ baseUrl, apiKey, cookie: profile.cookie, method, route, body, timeoutMs });
      printResult(result, asJson);
      process.exit(result.ok ? EXIT.OK : mapStatusToExit(result.status));
    }

    // Events watch (SSE)
    if (group === 'events' && action === 'watch') {
      await handleEventsWatch(parsed.flags, { ...ctx, timeoutMs: Number(parsed.flags['timeout-ms'] || 3600000) });
      return;
    }

    // Look up group and action in the commands map
    const groupMap = commands[group];
    if (!groupMap) {
      console.error(`Unknown group: ${group}`);
      usage();
      process.exit(EXIT.USAGE);
    }

    let handler = groupMap[action];
    if (!handler) {
      console.error(`Unknown action: ${group} ${action}`);
      usage();
      process.exit(EXIT.USAGE);
    }

    // Inject sub-command into flags for compound commands (memory, soul, comments)
    if (sub && typeof handler === 'function') {
      parsed.flags._sub = sub;
    }

    // Execute handler
    const result_or_config = await (typeof handler === 'function'
      ? handler(parsed.flags, ctx)
      : handler);

    // If handler returned an http result directly (auth login/logout)
    if (result_or_config && 'ok' in result_or_config && 'status' in result_or_config) {
      printResult(result_or_config, asJson);
      process.exit(result_or_config.ok ? EXIT.OK : mapStatusToExit(result_or_config.status));
    }

    // Otherwise it returned { method, route, body? } — execute the request
    const { method, route, body } = result_or_config;
    const result = await httpRequest({
      baseUrl,
      apiKey,
      cookie: profile.cookie,
      method,
      route,
      body,
      timeoutMs,
    });

    printResult(result, asJson);
    process.exit(result.ok ? EXIT.OK : mapStatusToExit(result.status));
  } catch (err) {
    const message = err?.message || String(err);
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`USAGE ERROR: ${message}`);
    }
    process.exit(EXIT.USAGE);
  }
}

run();
