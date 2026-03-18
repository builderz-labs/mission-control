import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export interface TaskTemplate {
  id: string
  name: string
  icon: string
  description: string
  defaults: {
    title: string
    description: string
    priority: string
    tags: string[]
    assigned_to?: string
    metadata?: Record<string, unknown>
  }
}

const TEMPLATES: TaskTemplate[] = [
  {
    id: 'meme-post',
    name: 'Meme Post',
    icon: '🎨',
    description: 'Generate and post a meme to X using xmeme + xpost',
    defaults: {
      title: 'Send a Meme Post To X',
      description: 'Use meme-post.sh to generate and post a meme to @ObsidianLabsAI.\n\nRun: `bash ~/.openclaw/scripts/meme-post.sh`',
      priority: 'low',
      tags: ['social', 'meme'],
      assigned_to: 'ralph',
      metadata: { complexity: 'routine', model_tier: 'haiku' },
    },
  },
  {
    id: 'content-post',
    name: 'Content Post',
    icon: '📝',
    description: 'Draft and post content to X for @ObsidianLabsAI or @SLPMoontis',
    defaults: {
      title: 'Draft and post content to X',
      description: 'Write a post for X. Topics: build-in-public, educational, data-alpha, or personality.\n\nUse `xpost tweet "text"` or `xqueue add "text"` for scheduling.',
      priority: 'medium',
      tags: ['social', 'content'],
      assigned_to: 'ralph',
      metadata: { complexity: 'routine', model_tier: 'haiku' },
    },
  },
  {
    id: 'code-review',
    name: 'Code Review',
    icon: '🔍',
    description: 'Review recent code changes for quality, security, and correctness',
    defaults: {
      title: 'Code review',
      description: 'Review recent commits for:\n- Security vulnerabilities\n- Logic errors\n- Missing tests\n- Code quality issues\n\nProvide specific findings with file:line references.',
      priority: 'medium',
      tags: ['engineering', 'review'],
      assigned_to: 'ralph',
      metadata: { complexity: 'moderate', model_tier: 'sonnet' },
    },
  },
  {
    id: 'research',
    name: 'Research',
    icon: '🔬',
    description: 'Research a topic, market, or technology and produce a brief',
    defaults: {
      title: 'Research brief',
      description: 'Research the specified topic and produce a brief with:\n- Key findings\n- Opportunities identified\n- Risks or concerns\n- Recommended next steps\n\nSave output to company/research/ or btc-5m-latency/docs/.',
      priority: 'medium',
      tags: ['research'],
      assigned_to: 'sentinel',
      metadata: { complexity: 'complex', model_tier: 'opus' },
    },
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    icon: '🐛',
    description: 'Investigate and fix a reported bug',
    defaults: {
      title: 'Fix bug',
      description: 'Investigate the reported issue:\n1. Reproduce the bug\n2. Identify root cause\n3. Implement fix\n4. Add test coverage\n5. Verify fix\n\nUse GitHub branch workflow.',
      priority: 'high',
      tags: ['engineering', 'bugfix'],
      assigned_to: 'ralph',
      metadata: { complexity: 'moderate', model_tier: 'sonnet' },
    },
  },
  {
    id: 'feature',
    name: 'New Feature',
    icon: '🚀',
    description: 'Plan and implement a new feature with PRD-driven workflow',
    defaults: {
      title: 'Implement feature',
      description: 'Plan and build the specified feature:\n1. Write or read the PRD\n2. Create feature branch\n3. Implement with tests\n4. Validate build\n5. Commit and push\n\nUse PRD-driven Ralph loops when appropriate.',
      priority: 'medium',
      tags: ['engineering', 'feature'],
      assigned_to: 'ralph',
      metadata: { complexity: 'complex', model_tier: 'opus' },
    },
  },
  {
    id: 'market-scan',
    name: 'Market Scan',
    icon: '📊',
    description: 'Scan markets for trading opportunities and report findings',
    defaults: {
      title: 'Market opportunity scan',
      description: 'Scan Polymarket and other prediction markets for:\n- Active tradeable markets\n- Structural edges\n- Pricing anomalies\n\nUpdate company/OPPORTUNITIES.md with findings.',
      priority: 'medium',
      tags: ['trading', 'research'],
      assigned_to: 'sentinel',
      metadata: { complexity: 'moderate', model_tier: 'sonnet' },
    },
  },
  {
    id: 'newsletter',
    name: 'Newsletter Draft',
    icon: '📰',
    description: 'Generate weekly newsletter draft from MC activity data',
    defaults: {
      title: 'Generate weekly newsletter draft',
      description: 'Run `newsletter-draft generate` to create this week\'s "The Agent Report".\n\nDraft saved to company/newsletters/ and company/newsletter-inbox.md.\nOwner edits and publishes to Substack.',
      priority: 'low',
      tags: ['content', 'newsletter'],
      assigned_to: 'ralph',
      metadata: { complexity: 'routine', model_tier: 'haiku' },
    },
  },
]

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ templates: TEMPLATES })
}
