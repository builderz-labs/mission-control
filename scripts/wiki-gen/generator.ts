// ---------------------------------------------------------------------------
// Wiki Generator — Claude API article generator
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { type ArticleSpec } from './types'

const client = new Anthropic()
// Use Haiku for cost-efficiency; Sonnet for higher fidelity if needed
const MODEL = process.env.WIKI_MODEL ?? 'claude-haiku-4-5'
const MAX_TOKENS = 4096

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const WIKI_DIR = path.join(REPO_ROOT, 'wiki')

const SYSTEM_PROMPT = `You are a technical writer producing operator documentation for Ultron Mission Control — an AI agent orchestration dashboard built on Next.js + SQLite.

Rules:
- Write in clear, professional markdown with H2/H3 headings
- Be precise and specific; avoid marketing language
- Include code blocks for CLI commands, env vars, API calls, and config snippets
- Add a "Last reviewed" datestamp at the top (use today's date)
- End with a "## Related" section linking to other wiki pages by slug
- Keep the content accurate to the source files provided — do not invent behaviour
- Target audience: DevOps operators and developers deploying or extending the system`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function outputPath(slug: string): string {
  return path.join(WIKI_DIR, `${slug}.md`)
}

function skipIfExists(slug: string): boolean {
  // Honour --force flag to overwrite
  if (process.argv.includes('--force')) return false
  return fs.existsSync(outputPath(slug))
}

// ---------------------------------------------------------------------------
// Main generate function
// ---------------------------------------------------------------------------

export async function generateArticle(
  spec: ArticleSpec,
  context: string,
): Promise<void> {
  if (skipIfExists(spec.slug)) {
    console.log(`  ⏭  ${spec.slug}.md already exists (use --force to overwrite)`)
    return
  }

  const userPrompt = `Generate a complete wiki article titled "# ${spec.title}".

Focus instructions: ${spec.focusPrompt}

Use the following source files as your ground truth. Only document behaviour that is evident in the sources:

${context}`

  console.log(`  ⚙  Generating ${spec.slug}.md via ${MODEL}...`)

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const chunks: string[] = []
  process.stdout.write('     ')

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      chunks.push(event.delta.text)
      // Progress dots so the operator sees activity
      if (chunks.length % 20 === 0) process.stdout.write('.')
    }
  }

  process.stdout.write('\n')

  const content = chunks.join('')
  if (!content.trim()) {
    throw new Error(`Empty response for article: ${spec.slug}`)
  }

  fs.mkdirSync(WIKI_DIR, { recursive: true })
  fs.writeFileSync(outputPath(spec.slug), content, 'utf8')

  const lines = content.split('\n').length
  console.log(`  ✅  ${spec.slug}.md — ${lines} lines written`)
}
