// ---------------------------------------------------------------------------
// Wiki Generator — shared types and article definitions
// ---------------------------------------------------------------------------

export interface SourceFile {
  path: string       // relative path for display
  content: string    // file content
  weight: number     // 1-10, higher = more relevant to most articles
}

export interface ArticleSpec {
  /** Output filename (no extension) */
  slug: string
  /** H1 title written into the article */
  title: string
  /**
   * Source file paths (glob-ish, relative to repo root) that are most
   * relevant for generating this article. The indexer also passes global
   * context files to every article.
   */
  relevantPaths: string[]
  /** Instruction appended to the system prompt for this specific article. */
  focusPrompt: string
}

// ---------------------------------------------------------------------------
// Article definitions — one entry per wiki page to generate
// ---------------------------------------------------------------------------

export const ARTICLES: ArticleSpec[] = [
  {
    slug: 'Getting-Started',
    title: 'Getting Started',
    relevantPaths: [
      'README.md',
      '.env.example',
      'docs/deployment.md',
      'docs/cli-integration.md',
      'install.sh',
      'scripts/generate-env.sh',
    ],
    focusPrompt:
      'Cover prerequisites, installation (pnpm install + .env setup), first login, ' +
      'gateway connection, and the 5-minute quickstart. Include common pitfalls.',
  },
  {
    slug: 'Architecture',
    title: 'Architecture',
    relevantPaths: [
      'src/lib/db.ts',
      'src/lib/event-bus.ts',
      'src/lib/websocket.ts',
      'src/lib/websocket-types.ts',
      'src/lib/task-dispatch.ts',
      'src/lib/self-learning.ts',
      'src/lib/self-healing',
      'src/lib/ultron-agents.ts',
      'src/store/index.ts',
    ],
    focusPrompt:
      'Describe the system architecture: Next.js App Router + SQLite, Zustand store, ' +
      'WebSocket gateway frame protocol, task dispatch pipeline, self-learning/healing engines, ' +
      'agent hierarchy (Commander → C-Suite → Specialists). Include a data-flow narrative.',
  },
  {
    slug: 'API-Guide',
    title: 'API Guide',
    relevantPaths: [
      'src/app/api',
      'src/lib/rate-limiter.ts',
      'src/lib/auth.ts',
    ],
    focusPrompt:
      'Document all API route groups: agents, tasks, gateways, sessions, chat, ' +
      'knowledge, exec-approvals, cron, super/*, ultron/*, releases, openclaw, marketing. ' +
      'Include auth requirements (session cookie vs API key), request/response shapes, ' +
      'and rate limiting behaviour.',
  },
  {
    slug: 'Security-Model',
    title: 'Security Model',
    relevantPaths: [
      'SECURITY.md',
      'src/lib/auth.ts',
      'src/lib/api-keys.ts',
      'src/middleware.ts',
      'src/lib/rate-limiter.ts',
      'src/lib/device-identity.ts',
      'docs/SECURITY-HARDENING.md',
    ],
    focusPrompt:
      'Cover: session cookie auth (httpOnly/secure/sameSite), API key RBAC, timing-safe ' +
      'comparison, rate limiting tiers, device identity Ed25519 signing, middleware guards, ' +
      'CSP headers, and the responsible-disclosure process.',
  },
  {
    slug: 'Operations-Runbook',
    title: 'Operations Runbook',
    relevantPaths: [
      'docs/deployment.md',
      'scripts/deploy-standalone.sh',
      'scripts/start-standalone.sh',
      'scripts/station-doctor.sh',
      'scripts/security-audit.sh',
      'scripts/agent-heartbeat.sh',
      'CHANGELOG.md',
    ],
    focusPrompt:
      'Cover: production deployment checklist, SQLite WAL backup procedure, zero-downtime ' +
      'upgrade steps, health checks (/api/health, station-doctor.sh), incident response, ' +
      'log locations, and rollback procedure.',
  },
  {
    slug: 'Integrations',
    title: 'Integrations',
    relevantPaths: [
      'docs/cli-integration.md',
      'src/app/api/webhooks',
      'src/lib/github.ts',
      'src/lib/jarvis',
      'src/lib/google-auth.ts',
      'src/app/api/marketing',
    ],
    focusPrompt:
      'Document: direct OpenClaw CLI integration, GitHub sync (repo/PR webhooks), ' +
      'Jarvis voice assistant setup, Google OAuth, Gamma marketing integration, ' +
      'and custom webhook endpoints (payload schema, security headers).',
  },
  {
    slug: 'FAQ',
    title: 'Frequently Asked Questions',
    relevantPaths: [
      'README.md',
      'CONTRIBUTING.md',
      'docs/deployment.md',
      'src/lib/db.ts',
    ],
    focusPrompt:
      'Answer common operator/admin questions: How do I reset my password? ' +
      'Why are sessions not showing? How do I add a custom agent? ' +
      'How do I back up the database? What happens when the gateway disconnects? ' +
      'How do I enable multi-tenant mode? Format as Q&A pairs.',
  },
]

// Global source files included in EVERY article's context
export const GLOBAL_SOURCES: string[] = [
  'README.md',
  'wiki/Home.md',
  'wiki/STYLE_GUIDE.md',
  '.env.example',
]
