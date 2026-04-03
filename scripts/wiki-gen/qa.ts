#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki Q&A Agent — answers questions using the full wiki as context
//
// Usage:
//   npx tsx scripts/wiki-gen/qa.ts "How do I reset my API key?"
//   npx tsx scripts/wiki-gen/qa.ts --interactive    # REPL mode
//
// Strategy: No RAG — the full wiki is small enough to fit in one prompt.
// Each question gets a fresh request with all wiki pages as context.
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

const client = new Anthropic()
const MODEL = process.env.WIKI_MODEL ?? 'claude-haiku-4-5'
const WIKI_DIR = path.resolve(__dirname, '..', '..', 'wiki')

const SYSTEM_PROMPT = `You are the Ultron Mission Control documentation assistant.
You answer operator and developer questions using ONLY the provided wiki pages.

Rules:
- Be concise and direct — lead with the answer, follow with explanation
- Include exact commands, config keys, or code snippets when relevant
- If the answer isn't in the wiki, say so clearly — don't invent behaviour
- Reference the relevant wiki page by name when useful
- Format with markdown (bold key terms, code blocks for commands)`

// ---------------------------------------------------------------------------
// Load all wiki pages into one context string
// ---------------------------------------------------------------------------

function loadWikiContext(): string {
  if (!fs.existsSync(WIKI_DIR)) {
    throw new Error(`Wiki directory not found: ${WIKI_DIR}. Run pnpm wiki:generate first.`)
  }

  const files = fs.readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()

  if (files.length === 0) {
    throw new Error('No wiki pages found. Run pnpm wiki:generate first.')
  }

  return files
    .map(f => {
      const content = fs.readFileSync(path.join(WIKI_DIR, f), 'utf8')
      return `=== ${f.replace('.md', '')} ===\n${content}`
    })
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Ask one question, stream the answer
// ---------------------------------------------------------------------------

async function ask(question: string, wikiContext: string): Promise<void> {
  const userMessage = `Wiki context:\n\n${wikiContext}\n\n---\n\nQuestion: ${question}`

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  process.stdout.write('\n')
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      process.stdout.write(event.delta.text)
    }
  }
  process.stdout.write('\n\n')
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function repl(wikiContext: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  console.log('📖  Ultron Wiki Q&A — type your question, Ctrl+C to exit\n')

  const prompt = (): void => {
    rl.question('❓ ', async (question) => {
      const q = question.trim()
      if (!q) { prompt(); return }
      if (q === 'exit' || q === 'quit') { rl.close(); return }

      try {
        await ask(q, wikiContext)
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
      prompt()
    })
  }

  prompt()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  const wikiContext = loadWikiContext()
  const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i')
  const question = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim()

  if (isInteractive || !question) {
    await repl(wikiContext)
  } else {
    await ask(question, wikiContext)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
