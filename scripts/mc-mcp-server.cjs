#!/usr/bin/env node
/*
 Mission Control MCP Server (stdio transport)
 - Zero dependencies (Node.js built-ins only)
 - JSON-RPC 2.0 over stdin/stdout
 - Wraps Mission Control REST API as MCP tools
 - Add with: claude mcp add mission-control -- node /path/to/mc-mcp-server.cjs

 Environment:
   MC_URL       Base URL (default: http://127.0.0.1:3000)
   MC_API_KEY   API key for auth
   MC_COOKIE    Session cookie (alternative auth)
*/

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig() {
  // Try profile first, then env vars
  const profilePath = path.join(os.homedir(), '.mission-control', 'profiles', 'default.json');
  let profile = {};
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch { /* no profile */ }

  return {
    baseUrl: (process.env.MC_URL || profile.url || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    apiKey: process.env.MC_API_KEY || profile.apiKey || '',
    cookie: process.env.MC_COOKIE || profile.cookie || '',
  };
}

// ---------------------------------------------------------------------------
// HTTP client (same pattern as mc-cli.cjs)
// ---------------------------------------------------------------------------

async function api(method, route, body) {
  const config = loadConfig();
  const headers = { 'Accept': 'application/json' };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;
  if (config.cookie) headers['Cookie'] = config.cookie;

  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const url = `${config.baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { method, headers, body: payload, signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}: ${text.slice(0, 200)}`);
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new Error('Request timeout (30s)');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  // --- Agents ---
  {
    name: 'mc_list_agents',
    description: 'List all agents registered in Mission Control',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/agents'),
  },
  {
    name: 'mc_get_agent',
    description: 'Get details of a specific agent by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/agents/${id}`),
  },
  {
    name: 'mc_heartbeat',
    description: 'Send a heartbeat for an agent to indicate it is alive',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('POST', `/api/agents/${id}/heartbeat`),
  },
  {
    name: 'mc_wake_agent',
    description: 'Wake a sleeping agent',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('POST', `/api/agents/${id}/wake`),
  },
  {
    name: 'mc_agent_diagnostics',
    description: 'Get diagnostics info for an agent (health, config, recent activity)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/agents/${id}/diagnostics`),
  },
  {
    name: 'mc_agent_attribution',
    description: 'Get cost attribution, audit trail, and mutation history for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Agent ID' },
        hours: { type: 'number', description: 'Lookback window in hours (default 24)' },
        section: { type: 'string', description: 'Comma-separated sections: identity,audit,mutations,cost' },
      },
      required: ['id'],
    },
    handler: async ({ id, hours, section }) => {
      let qs = `?hours=${hours || 24}`;
      if (section) qs += `&section=${encodeURIComponent(section)}`;
      return api('GET', `/api/agents/${id}/attribution${qs}`);
    },
  },

  // --- Agent Memory ---
  {
    name: 'mc_read_memory',
    description: 'Read an agent\'s working memory',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/agents/${id}/memory`),
  },
  {
    name: 'mc_write_memory',
    description: 'Write or append to an agent\'s working memory',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Agent ID' },
        working_memory: { type: 'string', description: 'Memory content to write' },
        append: { type: 'boolean', description: 'Append to existing memory instead of replacing (default false)' },
      },
      required: ['id', 'working_memory'],
    },
    handler: async ({ id, working_memory, append }) =>
      api('PUT', `/api/agents/${id}/memory`, { working_memory, append: append || false }),
  },
  {
    name: 'mc_clear_memory',
    description: 'Clear an agent\'s working memory',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('DELETE', `/api/agents/${id}/memory`),
  },

  // --- Knowledge Base (filesystem memory) ---
  {
    name: 'mc_search_knowledge',
    description: 'Full-text search across the knowledge base (memory files). Uses FTS5 with BM25 ranking. Supports operators: AND, OR, NOT, NEAR, "exact phrase", prefix*. Auto-builds index on first search.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (supports FTS5 syntax)' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
      required: ['q'],
    },
    handler: async ({ q, limit }) => {
      const params = new URLSearchParams({ q });
      if (limit) params.set('limit', String(limit));
      return api('GET', `/api/memory/search?${params}`);
    },
  },
  {
    name: 'mc_read_knowledge_file',
    description: 'Read a file from the knowledge base (memory filesystem). Returns content, wiki-links, and schema validation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path (e.g., "memory/projects/my-project.md")' },
      },
      required: ['path'],
    },
    handler: async ({ path }) => api('GET', `/api/memory?action=content&path=${encodeURIComponent(path)}`),
  },
  {
    name: 'mc_write_knowledge_file',
    description: 'Create or update a file in the knowledge base. Use for saving decisions, project notes, lessons learned.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path (e.g., "memory/decisions/auth-strategy.md")' },
        content: { type: 'string', description: 'File content (markdown)' },
        create: { type: 'boolean', description: 'If true, create new file (fails if exists). If false/omitted, overwrite existing.' },
      },
      required: ['path', 'content'],
    },
    handler: async ({ path, content, create }) =>
      api('POST', '/api/memory', { action: create ? 'create' : 'save', path, content }),
  },
  {
    name: 'mc_knowledge_health',
    description: 'Run health diagnostics on the knowledge base. Returns scores for schema compliance, connectivity, link integrity, freshness, atomicity, naming, organization, and description quality.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/memory/health'),
  },
  {
    name: 'mc_rebuild_search_index',
    description: 'Rebuild the full-text search index from all knowledge base files. Use after bulk imports or if search results seem stale.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('POST', '/api/memory/search', { action: 'rebuild' }),
  },
  {
    name: 'mc_knowledge_gaps',
    description: 'Detect knowledge gaps: broken wiki-links, orphan files, stale content, and missing topics referenced across multiple files. Returns severity-scored gaps sorted by importance.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('POST', '/api/memory/process', { action: 'gap-detect' }),
  },
  {
    name: 'mc_knowledge_consolidate',
    description: 'Analyze knowledge graph structure: find hub nodes (critical files), bridge nodes (connectivity bottlenecks), clusters (tightly connected groups), and weak edges (pruning candidates). Returns network statistics.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('POST', '/api/memory/process', { action: 'consolidate' }),
  },

  // --- Agent Soul ---
  {
    name: 'mc_read_soul',
    description: 'Read an agent\'s SOUL (System of Unified Logic) content — the agent\'s identity and behavioral directives',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Agent ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/agents/${id}/soul`),
  },
  {
    name: 'mc_write_soul',
    description: 'Write an agent\'s SOUL content, or apply a named template',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Agent ID' },
        soul_content: { type: 'string', description: 'SOUL content to write (omit if using template_name)' },
        template_name: { type: 'string', description: 'Name of a SOUL template to apply (omit if providing soul_content)' },
      },
      required: ['id'],
    },
    handler: async ({ id, soul_content, template_name }) => {
      const body = {};
      if (template_name) body.template_name = template_name;
      else if (soul_content) body.soul_content = soul_content;
      return api('PUT', `/api/agents/${id}/soul`, body);
    },
  },
  {
    name: 'mc_list_soul_templates',
    description: 'List available SOUL templates, or retrieve a specific template\'s content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Agent ID' },
        template: { type: 'string', description: 'Template name to retrieve (omit to list all)' },
      },
      required: ['id'],
    },
    handler: async ({ id, template }) => {
      const qs = template ? `?template=${encodeURIComponent(template)}` : '';
      return api('PATCH', `/api/agents/${id}/soul${qs}`);
    },
  },

  // --- Tasks ---
  {
    name: 'mc_list_tasks',
    description: 'List tasks in Mission Control with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: backlog, inbox, assigned, awaiting_owner, in_progress, review, quality_review, done, failed' },
        assigned_to: { type: 'string', description: 'Filter by assigned agent name' },
        priority: { type: 'string', description: 'Filter by priority: low, medium, high, critical' },
        search: { type: 'string', description: 'Search in task title (partial match)' },
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
      },
      required: [],
    },
    handler: async ({ status, assigned_to, priority, search, limit } = {}) => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (assigned_to) params.set('assigned_to', assigned_to)
      if (priority) params.set('priority', priority)
      if (limit) params.set('limit', String(Math.min(limit, 200)))
      const qs = params.toString() ? `?${params.toString()}` : ''
      const result = await api('GET', `/api/tasks${qs}`)
      if (search && result?.tasks) {
        const term = search.toLowerCase()
        result.tasks = result.tasks.filter(t => t.title?.toLowerCase().includes(term))
      }
      return result
    },
  },
  {
    name: 'mc_get_task',
    description: 'Get a specific task by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Task ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/tasks/${id}`),
  },
  {
    name: 'mc_create_task',
    description: 'Create a new task',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Priority: low, medium, high, critical' },
        assigned_to: { type: 'string', description: 'Agent name to assign to' },
      },
      required: ['title'],
    },
    handler: async (args) => api('POST', '/api/tasks', args),
  },
  {
    name: 'mc_update_task',
    description: 'Update an existing task (status, priority, assigned_to, title, description, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Task ID' },
        status: { type: 'string', description: 'New status' },
        priority: { type: 'string', description: 'New priority' },
        assigned_to: { type: 'string', description: 'New assignee agent name' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['id'],
    },
    handler: async ({ id, ...fields }) => api('PUT', `/api/tasks/${id}`, fields),
  },
  {
    name: 'mc_poll_task_queue',
    description: 'Poll the task queue for an agent — returns the next available task(s) to work on',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name to poll for' },
        max_capacity: { type: 'number', description: 'Max tasks to return (default 1)' },
      },
      required: ['agent'],
    },
    handler: async ({ agent, max_capacity }) => {
      let qs = `?agent=${encodeURIComponent(agent)}`;
      if (max_capacity) qs += `&max_capacity=${max_capacity}`;
      return api('GET', `/api/tasks/queue${qs}`);
    },
  },
  {
    name: 'mc_broadcast_task',
    description: 'Broadcast a message to all subscribers of a task',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Task ID' },
        message: { type: 'string', description: 'Message to broadcast' },
      },
      required: ['id', 'message'],
    },
    handler: async ({ id, message }) => api('POST', `/api/tasks/${id}/broadcast`, { message }),
  },

  // --- Task Comments ---
  {
    name: 'mc_list_comments',
    description: 'List comments on a task',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'Task ID' } },
      required: ['id'],
    },
    handler: async ({ id }) => api('GET', `/api/tasks/${id}/comments`),
  },
  {
    name: 'mc_add_comment',
    description: 'Add a comment to a task',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'Task ID' },
        content: { type: 'string', description: 'Comment text (supports @mentions)' },
        parent_id: { type: 'number', description: 'Parent comment ID for threaded replies' },
      },
      required: ['id', 'content'],
    },
    handler: async ({ id, content, parent_id }) => {
      const body = { content };
      if (parent_id) body.parent_id = parent_id;
      return api('POST', `/api/tasks/${id}/comments`, body);
    },
  },

  // --- Sessions ---
  {
    name: 'mc_list_sessions',
    description: 'List all active sessions',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/sessions'),
  },
  {
    name: 'mc_control_session',
    description: 'Control a session (monitor, pause, or terminate)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session ID' },
        action: { type: 'string', description: 'Action: monitor, pause, or terminate' },
      },
      required: ['id', 'action'],
    },
    handler: async ({ id, action }) => api('POST', `/api/sessions/${id}/control`, { action }),
  },
  {
    name: 'mc_continue_session',
    description: 'Send a follow-up prompt to an existing session',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Session kind: claude-code, codex-cli, hermes' },
        id: { type: 'string', description: 'Session ID' },
        prompt: { type: 'string', description: 'Follow-up prompt to send' },
      },
      required: ['kind', 'id', 'prompt'],
    },
    handler: async ({ kind, id, prompt }) =>
      api('POST', '/api/sessions/continue', { kind, id, prompt }),
  },
  {
    name: 'mc_session_transcript',
    description: 'Get the transcript of a session (messages, tool calls, reasoning)',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Session kind: claude-code, codex-cli, hermes' },
        id: { type: 'string', description: 'Session ID' },
        limit: { type: 'number', description: 'Max messages to return (default 40, max 200)' },
      },
      required: ['kind', 'id'],
    },
    handler: async ({ kind, id, limit }) => {
      let qs = `?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
      if (limit) qs += `&limit=${limit}`;
      return api('GET', `/api/sessions/transcript${qs}`);
    },
  },

  // --- Connections ---
  {
    name: 'mc_list_connections',
    description: 'List active agent connections (tool registrations)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/connect'),
  },
  {
    name: 'mc_register_connection',
    description: 'Register a tool connection for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Tool name to register' },
        agent_name: { type: 'string', description: 'Agent name to connect' },
      },
      required: ['tool_name', 'agent_name'],
    },
    handler: async (args) => api('POST', '/api/connect', args),
  },

  // --- Tokens & Costs ---
  {
    name: 'mc_token_stats',
    description: 'Get aggregate token usage statistics (total tokens, cost, request count, per-model breakdown)',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', description: 'Timeframe: hour, day, week, month, all (default: all)' },
      },
      required: [],
    },
    handler: async ({ timeframe }) => {
      let qs = '?action=stats';
      if (timeframe) qs += `&timeframe=${encodeURIComponent(timeframe)}`;
      return api('GET', `/api/tokens${qs}`);
    },
  },
  {
    name: 'mc_agent_costs',
    description: 'Get per-agent cost breakdown with timeline and model details',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', description: 'Timeframe: hour, day, week, month, all' },
      },
      required: [],
    },
    handler: async ({ timeframe }) => {
      let qs = '?action=agent-costs';
      if (timeframe) qs += `&timeframe=${encodeURIComponent(timeframe)}`;
      return api('GET', `/api/tokens${qs}`);
    },
  },
  {
    name: 'mc_costs_by_agent',
    description: 'Get per-agent cost summary over a number of days',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback in days (default 30, max 365)' },
      },
      required: [],
    },
    handler: async ({ days }) =>
      api('GET', `/api/tokens/by-agent?days=${days || 30}`),
  },

  // --- Skills ---
  {
    name: 'mc_list_skills',
    description: 'List all skills available in the system',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/skills'),
  },
  {
    name: 'mc_read_skill',
    description: 'Read the content of a specific skill',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Skill source (e.g. workspace, system)' },
        name: { type: 'string', description: 'Skill name' },
      },
      required: ['source', 'name'],
    },
    handler: async ({ source, name }) =>
      api('GET', `/api/skills?mode=content&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}`),
  },

  // --- Cron ---
  {
    name: 'mc_list_cron',
    description: 'List all cron jobs',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/cron'),
  },

  // --- Status ---
  {
    name: 'mc_health',
    description: 'Check Mission Control health status (no auth required)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/status?action=health'),
  },
  {
    name: 'mc_dashboard',
    description: 'Get a dashboard summary of the entire Mission Control system (agents, tasks, sessions, costs)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/status?action=dashboard'),
  },
  {
    name: 'mc_status',
    description: 'Get system status overview (uptime, memory, disk, sessions, processes)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => api('GET', '/api/status?action=overview'),
  },

  // --- Runs (agent-run protocol) ---
  {
    name: 'mc_list_runs',
    description: 'List agent runs with optional filtering by agent, status, or time range',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter by agent ID' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout'] },
        since: { type: 'string', description: 'ISO 8601 timestamp — only runs after this time' },
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
      },
      required: [],
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.agent_id) params.set('agent_id', args.agent_id);
      if (args.status) params.set('status', args.status);
      if (args.since) params.set('since', args.since);
      if (args.limit) params.set('limit', String(args.limit));
      return api('GET', `/api/v1/runs?${params}`);
    },
  },
  {
    name: 'mc_get_run',
    description: 'Get a single agent run by ID, including steps, cost, provenance, and eval',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string', description: 'Run ID' } },
      required: ['run_id'],
    },
    handler: async (args) => api('GET', `/api/v1/runs/${encodeURIComponent(args.run_id)}`),
  },
  {
    name: 'mc_create_run',
    description: 'Report a new agent run to Mission Control (agent-run protocol)',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent identifier' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        model: { type: 'string', description: 'Model used (e.g. claude-sonnet-4-5-20250514)' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
        trigger: { type: 'string', enum: ['manual', 'cron', 'webhook', 'agent', 'pipeline', 'queue'] },
        task_id: { type: 'string', description: 'Associated task ID' },
        started_at: { type: 'string', description: 'ISO 8601 start time' },
      },
      required: ['agent_id', 'status', 'started_at'],
    },
    handler: async (args) => api('POST', '/api/v1/runs', args),
  },
  {
    name: 'mc_update_run',
    description: 'Update a run (status, outcome, cost, error)',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Run ID to update' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] },
        outcome: { type: 'string', enum: ['success', 'failed', 'partial', 'abandoned'] },
        ended_at: { type: 'string', description: 'ISO 8601 end time' },
        duration_ms: { type: 'number' },
        error: { type: 'string' },
      },
      required: ['run_id'],
    },
    handler: async (args) => {
      const { run_id, ...updates } = args;
      return api('PATCH', `/api/v1/runs/${encodeURIComponent(run_id)}`, updates);
    },
  },
  {
    name: 'mc_run_provenance',
    description: 'Get the provenance (hash chain, model version, config hash) for a run',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
    },
    handler: async (args) => api('GET', `/api/v1/runs/${encodeURIComponent(args.run_id)}/provenance`),
  },
  {
    name: 'mc_attach_eval',
    description: 'Attach an evaluation result (pass/fail, score) to a run',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        pass: { type: 'boolean', description: 'Whether the run passed evaluation' },
        score: { type: 'number', description: 'Score 0-100' },
        task_type: { type: 'string', description: 'Category (e.g. pr-review, bug-fix, test-gen)' },
        detail: { type: 'string', description: 'Evaluation notes' },
      },
      required: ['run_id', 'pass', 'score'],
    },
    handler: async (args) => {
      const { run_id, ...evalData } = args;
      return api('PUT', `/api/v1/runs/${encodeURIComponent(run_id)}/eval`, evalData);
    },
  },
  {
    name: 'mc_eval_leaderboard',
    description: 'Get the eval leaderboard — agents ranked by avg score, pass rate, and cost',
    inputSchema: {
      type: 'object',
      properties: {
        benchmark_id: { type: 'string', description: 'Filter by benchmark pack' },
        limit: { type: 'number', description: 'Max entries (default 50)' },
      },
      required: [],
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.benchmark_id) params.set('benchmark_id', args.benchmark_id);
      if (args.limit) params.set('limit', String(args.limit));
      return api('GET', `/api/v1/evals/leaderboard?${params}`);
    },
  },
];

// Build lookup map
const toolMap = new Map();
for (const tool of TOOLS) {
  toolMap.set(tool.name, tool);
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 / MCP protocol handler
// ---------------------------------------------------------------------------

const SERVER_INFO = {
  name: 'mission-control',
  version: '2.0.1',
};

const CAPABILITIES = {
  tools: {},
};

function makeResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Notifications (no id) — just acknowledge
  if (id === undefined) {
    if (method === 'notifications/initialized') return null; // no response needed
    return null;
  }

  switch (method) {
    case 'initialize':
      return makeResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case 'tools/list':
      return makeResponse(id, {
        tools: TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const tool = toolMap.get(toolName);

      if (!tool) {
        return makeResponse(id, {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          isError: true,
        });
      }

      try {
        const result = await tool.handler(args);
        return makeResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return makeResponse(id, {
          content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
          isError: true,
        });
      }
    }

    case 'ping':
      return makeResponse(id, {});

    default:
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

function send(msg) {
  if (!msg) return;
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

async function main() {
  // Disable stdout buffering for interactive use
  if (process.stdout._handle && process.stdout._handle.setBlocking) {
    process.stdout._handle.setBlocking(true);
  }

  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);
      const response = await handleMessage(msg);
      send(response);
    } catch (err) {
      send(makeError(null, -32700, `Parse error: ${err?.message || 'invalid JSON'}`));
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Keep process alive
  process.stdin.resume();
}

main();
