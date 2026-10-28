import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const ORGANIZATIONAL_BRAIN_ROOT =
  process.env.ORGANIZATIONAL_BRAIN_ROOT?.trim() || 'C:\\Dev\\obsidian\\jsy_hide'

export const ORGANIZATIONAL_BRAIN_ENTRY = 'AGENT_BRAIN.md'

export const BRAIN_ROUTES = {
  company_os: '20 Areas/AI Company OS/00_COMPANY_BRAIN_HUB.md',
  productbaton: '10 Projects/LaunchLot/00_LAUNCHLOT_HUB.md',
  shufuro: '10 Projects/Shufuro/00_SHUFURO_HUB.md',
  career: '10 Projects/28卒 Job Hunting/00_CAREER_HUB.md',
  hennge_english: '10 Projects/HENNGE English/00_HENNGE_ENGLISH_HUB.md',
  app_scout: '20 Areas/AI Company OS/Playbooks/APP_OPPORTUNITY_SCOUT.md',
  revenue_factory: '20 Areas/AI Company OS/Playbooks/APP_OPPORTUNITY_SCOUT.md',
} as const

function safePath(relativePath: string): string {
  const root = resolve(ORGANIZATIONAL_BRAIN_ROOT)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + '\\')) {
    throw new Error('Brain path escapes canonical root')
  }
  return target
}

export async function getOrganizationalBrainStatus() {
  const entryPath = safePath(ORGANIZATIONAL_BRAIN_ENTRY)
  if (!existsSync(entryPath)) {
    return {
      connected: false,
      readable: false,
      root: ORGANIZATIONAL_BRAIN_ROOT,
      entry: ORGANIZATIONAL_BRAIN_ENTRY,
      entry_path: entryPath,
      modified: null as number | null,
      size: null as number | null,
      routes: BRAIN_ROUTES,
    }
  }

  try {
    const info = await stat(entryPath)
    await readFile(entryPath, { encoding: 'utf-8' })
    return {
      connected: true,
      readable: true,
      root: ORGANIZATIONAL_BRAIN_ROOT,
      entry: ORGANIZATIONAL_BRAIN_ENTRY,
      entry_path: entryPath,
      modified: info.mtimeMs,
      size: info.size,
      routes: BRAIN_ROUTES,
    }
  } catch {
    return {
      connected: true,
      readable: false,
      root: ORGANIZATIONAL_BRAIN_ROOT,
      entry: ORGANIZATIONAL_BRAIN_ENTRY,
      entry_path: entryPath,
      modified: null as number | null,
      size: null as number | null,
      routes: BRAIN_ROUTES,
    }
  }
}

export async function readOrganizationalBrainEntry() {
  const status = await getOrganizationalBrainStatus()
  if (!status.readable) throw new Error('Organizational Brain entry point is not readable')
  const content = await readFile(status.entry_path, 'utf-8')
  return {
    ...status,
    content,
    retrieval_policy: {
      mode: 'selective',
      sequence: ['AGENT_BRAIN.md', 'relevant project/department hub', 'relevant playbook/skill/decision'],
      full_vault_ingest: false,
      writes: 'explicit-approved-action-only',
    },
  }
}
