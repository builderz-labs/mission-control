#!/usr/bin/env node
/**
 * jarvis-sync-token.mjs
 *
 * Reads the auto-generated JARVIS_AUTH_TOKEN from src/jarvis/.env and writes
 * the three vars the Next.js frontend needs into the project-root .env file.
 *
 * Run once after starting the Jarvis backend for the first time, or whenever
 * the token is regenerated:
 *
 *   node scripts/jarvis-sync-token.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const JARVIS_ENV = resolve(ROOT, 'src/jarvis/.env')
const NEXT_ENV = resolve(ROOT, '.env')

// ── 1. Read token from Python backend env ──────────────────────────────────

if (!existsSync(JARVIS_ENV)) {
  console.error(
    `\n[jarvis-sync] ERROR: ${JARVIS_ENV} not found.\n` +
    `  Start the Jarvis backend at least once so it can generate the token:\n` +
    `    cd src/jarvis && python server.py\n`
  )
  process.exit(1)
}

let jarvisEnvContent = readFileSync(JARVIS_ENV, 'utf8')
const tokenMatch = jarvisEnvContent.match(/^JARVIS_AUTH_TOKEN=(.+)$/m)

if (!tokenMatch) {
  console.error(
    `\n[jarvis-sync] ERROR: JARVIS_AUTH_TOKEN not found in ${JARVIS_ENV}.\n` +
    `  Start the Jarvis backend to auto-generate it, then re-run this script.\n`
  )
  process.exit(1)
}

const token = tokenMatch[1].trim()

// ── 1b. Write MC_PORT to src/jarvis/.env so Jarvis CORS allows Ultron's port ─
const mcPort = process.env.PORT ?? '3000'
const mcPortPattern = /^MC_PORT=.*$/m
const mcPortLine = `MC_PORT=${mcPort}`
if (mcPortPattern.test(jarvisEnvContent)) {
  jarvisEnvContent = jarvisEnvContent.replace(mcPortPattern, mcPortLine)
} else {
  jarvisEnvContent = jarvisEnvContent.endsWith('\n') || jarvisEnvContent === ''
    ? `${jarvisEnvContent}${mcPortLine}\n`
    : `${jarvisEnvContent}\n${mcPortLine}\n`
}
writeFileSync(JARVIS_ENV, jarvisEnvContent, 'utf8')

// ── 2. Load or create Next.js .env file ────────────────────────────────────

let envContent = existsSync(NEXT_ENV) ? readFileSync(NEXT_ENV, 'utf8') : ''

// Keys to set (server-side + client-side)
const vars = {
  JARVIS_ENABLED: 'true',
  NEXT_PUBLIC_JARVIS_ENABLED: 'true',
  NEXT_PUBLIC_JARVIS_AUTH_TOKEN: token,
}

// ── 3. Upsert each key ─────────────────────────────────────────────────────

for (const [key, value] of Object.entries(vars)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  if (pattern.test(envContent)) {
    // Update existing line
    envContent = envContent.replace(pattern, line)
  } else {
    // Append with trailing newline
    envContent = envContent.endsWith('\n') || envContent === ''
      ? `${envContent}${line}\n`
      : `${envContent}\n${line}\n`
  }
}

writeFileSync(NEXT_ENV, envContent, 'utf8')

console.log(`\n[jarvis-sync] Done. Synced to ${NEXT_ENV}:`)
for (const key of Object.keys(vars)) {
  const display = key.includes('TOKEN') ? `${token.slice(0, 8)}…` : vars[key]
  console.log(`  ${key}=${display}`)
}
console.log(`\n  Restart "pnpm dev" to pick up the changes.\n`)
