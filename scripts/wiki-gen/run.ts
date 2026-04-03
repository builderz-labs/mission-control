#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Wiki Generator — main entry point
//
// Usage:
//   npx tsx scripts/wiki-gen/run.ts                  # generate all articles
//   npx tsx scripts/wiki-gen/run.ts Architecture     # generate one article
//   npx tsx scripts/wiki-gen/run.ts --force          # overwrite existing
//
// Env:
//   ANTHROPIC_API_KEY  — required
//   WIKI_MODEL         — optional, defaults to claude-haiku-4-5
// ---------------------------------------------------------------------------
import { ARTICLES, GLOBAL_SOURCES } from './types'
import { loadSources, loadRawSources, buildContext } from './indexer'
import { generateArticle } from './generator'

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  // Determine which articles to generate
  const slugFilter = process.argv
    .slice(2)
    .filter(a => !a.startsWith('--'))
  const targets = slugFilter.length > 0
    ? ARTICLES.filter(a => slugFilter.includes(a.slug))
    : ARTICLES

  if (targets.length === 0) {
    console.error(`No matching articles found. Valid slugs: ${ARTICLES.map(a => a.slug).join(', ')}`)
    process.exit(1)
  }

  // Load global context once — included in every article
  const rawSources = loadRawSources()
  const globalSources = loadSources(GLOBAL_SOURCES, 6)

  console.log(`\n🔧  Ultron Wiki Generator`)
  console.log(`   Articles : ${targets.map(a => a.slug).join(', ')}`)
  console.log(`   Model    : ${process.env.WIKI_MODEL ?? 'claude-haiku-4-5'}`)
  console.log(`   Raw docs : ${rawSources.length} file(s) from wiki/raw/`)
  console.log()

  let succeeded = 0
  let failed = 0

  for (const spec of targets) {
    console.log(`📄  ${spec.slug}`)

    try {
      // Article-specific sources + global context + raw operator docs
      const articleSources = loadSources(spec.relevantPaths, 9)
      const allSources = [...articleSources, ...globalSources, ...rawSources]
      const context = buildContext(allSources)

      await generateArticle(spec, context)
      succeeded++
    } catch (err) {
      console.error(`  ❌  Failed: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }

    console.log()
  }

  console.log(`\n✨  Done — ${succeeded} generated, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
