/**
 * Registry source clients — search and raw-fetch for ClawdHub, skills.sh,
 * and the Awesome OpenClaw GitHub index.
 *
 * All network calls are server-side only; never called from the browser.
 */

import { getErrorMessage } from '../types/sql'
import { logger } from '../logger'
import type { RegistrySkill, RegistrySearchResult } from './types'

const CLAWHUB_API = 'https://clawhub.ai/api'
const SKILLS_SH_API = 'https://skills.sh/api'
const AWESOME_OPENCLAW_README =
  'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md'
export const AWESOME_OPENCLAW_RAW_BASE =
  'https://raw.githubusercontent.com/openclaw/skills/main/skills'
const FETCH_TIMEOUT = 10_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Awesome OpenClaw — in-memory cached index from GitHub README
// ---------------------------------------------------------------------------

const AWESOME_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
let awesomeCache: { skills: RegistrySkill[]; fetchedAt: number } | null = null

const AWESOME_ENTRY_RE =
  /^- \[([^\]]+)\]\(https:\/\/github\.com\/openclaw\/skills\/tree\/main\/skills\/([^/]+)\/([^/]+)\/SKILL\.md\)\s*-\s*(.+)$/gm

export function parseAwesomeReadme(markdown: string): RegistrySkill[] {
  const skills: RegistrySkill[] = []
  let match: RegExpExecArray | null
  while ((match = AWESOME_ENTRY_RE.exec(markdown)) !== null) {
    const [, name, author, skillName, description] = match
    skills.push({
      slug: `${author}/${skillName}`,
      name: name || skillName,
      description: description.trim(),
      author,
      version: 'latest',
      source: 'awesome-openclaw',
    })
  }
  return skills
}

async function fetchAwesomeIndex(): Promise<RegistrySkill[]> {
  const now = Date.now()
  if (awesomeCache && now - awesomeCache.fetchedAt < AWESOME_CACHE_TTL) {
    return awesomeCache.skills
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let res: Response
    try {
      res = await fetch(AWESOME_OPENCLAW_README, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`GitHub fetch failed (${res.status})`)
    const markdown = await res.text()
    const skills = parseAwesomeReadme(markdown)
    awesomeCache = { skills, fetchedAt: now }
    return skills
  } catch (err: unknown) {
    logger.warn({ err: getErrorMessage(err) }, 'Awesome OpenClaw fetch error')
    if (awesomeCache) return awesomeCache.skills // stale fallback
    return []
  }
}

export async function searchAwesomeOpenclaw(
  query: string
): Promise<RegistrySearchResult> {
  const index = await fetchAwesomeIndex()
  const q = query.toLowerCase()
  const matched = index
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q)
    )
    .slice(0, 50)
  return { skills: matched, total: matched.length, source: 'awesome-openclaw' }
}

export async function fetchAwesomeOpenclawSkill(
  slug: string
): Promise<{ content: string }> {
  const url = `${AWESOME_OPENCLAW_RAW_BASE}/${slug}/SKILL.md`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`Awesome OpenClaw skill fetch failed (${res.status})`)
  const content = await res.text()
  return { content }
}

// ---------------------------------------------------------------------------
// ClawdHub
// ---------------------------------------------------------------------------

export async function searchClawdHub(
  query: string
): Promise<RegistrySearchResult> {
  // WHY: ClawdHub migrated its API — try multiple URL patterns for resilience
  const urls = [
    `${CLAWHUB_API}/search?q=${encodeURIComponent(query)}`,
    `${CLAWHUB_API}/search?query=${encodeURIComponent(query)}`,
    `${CLAWHUB_API}/skills/search?q=${encodeURIComponent(query)}`,
  ]

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        logger.warn({ status: res.status, url }, 'ClawdHub search request failed')
        continue
      }

      const data = (await res.json()) as Record<string, unknown>
      const rows: Record<string, unknown>[] = Array.isArray(data?.['results'])
        ? (data['results'] as Record<string, unknown>[])
        : Array.isArray(data?.['skills'])
          ? (data['skills'] as Record<string, unknown>[])
          : []

      const skills: RegistrySkill[] = rows.map((s) => ({
        slug: String(s['slug'] || s['id'] || s['name'] || ''),
        name: String(s['displayName'] || s['name'] || s['slug'] || ''),
        description: String(s['summary'] || s['description'] || ''),
        author: String(s['author'] || s['owner'] || 'unknown'),
        version: String(s['version'] || s['latest_version'] || 'latest'),
        source: 'clawhub' as const,
        installCount:
          s['installs'] != null
            ? Number(s['installs'])
            : s['install_count'] != null
              ? Number(s['install_count'])
              : undefined,
        tags: Array.isArray(s['tags']) ? (s['tags'] as string[]) : undefined,
        hash:
          s['hash'] != null
            ? String(s['hash'])
            : s['sha256'] != null
              ? String(s['sha256'])
              : undefined,
      }))

      if (skills.length > 0) {
        return {
          skills,
          total:
            data?.['total'] != null ? Number(data['total']) : skills.length,
          source: 'clawhub',
        }
      }
    } catch (err: unknown) {
      logger.warn({ err: getErrorMessage(err), url }, 'ClawdHub search error')
    }
  }

  return { skills: [], total: 0, source: 'clawhub' }
}

export async function fetchClawdHubSkill(
  slug: string
): Promise<{ content: string; hash?: string }> {
  const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}/content`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`ClawdHub fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, unknown>
  const content = String(data['content'] || data['skill_md'] || '')
  const hash =
    data['hash'] != null
      ? String(data['hash'])
      : data['sha256'] != null
        ? String(data['sha256'])
        : undefined
  return { content, hash }
}

// ---------------------------------------------------------------------------
// skills.sh
// ---------------------------------------------------------------------------

export async function searchSkillsSh(
  query: string
): Promise<RegistrySearchResult> {
  // WHY: skills.sh migrated its API — try multiple URL patterns for resilience
  const urls = [
    `${SKILLS_SH_API}/search?q=${encodeURIComponent(query)}`,
    `${SKILLS_SH_API}/search?query=${encodeURIComponent(query)}`,
    `${SKILLS_SH_API}/skills?q=${encodeURIComponent(query)}`,
  ]

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        logger.warn({ status: res.status, url }, 'skills.sh search request failed')
        continue
      }

      const data = (await res.json()) as Record<string, unknown>
      const rows: Record<string, unknown>[] = Array.isArray(data?.['skills'])
        ? (data['skills'] as Record<string, unknown>[])
        : Array.isArray(data?.['results'])
          ? (data['results'] as Record<string, unknown>[])
          : []

      const skills: RegistrySkill[] = rows.map((s) => {
        const source = typeof s['source'] === 'string' ? s['source'] : 'unknown'
        const slug = String(
          s['slug'] ||
            s['id'] ||
            (source && s['skillId'] ? `${source}/${s['skillId']}` : s['name']) ||
            ''
        )
        return {
          slug,
          name: String(s['name'] || s['skillId'] || s['slug'] || 'unnamed-skill'),
          description: String(s['description'] || s['summary'] || ''),
          author: String(
            s['owner'] ||
              s['author'] ||
              (source.includes('/') ? source.split('/')[0] : source)
          ),
          version: String(s['version'] || 'latest'),
          source: 'skills-sh' as const,
          installCount:
            s['installs'] != null
              ? Number(s['installs'])
              : s['install_count'] != null
                ? Number(s['install_count'])
                : undefined,
          tags: Array.isArray(s['tags']) ? (s['tags'] as string[]) : undefined,
          url: s['url'] != null ? String(s['url']) : undefined,
        }
      })

      if (skills.length > 0) {
        return {
          skills,
          total: Number(data?.['total'] || data?.['count'] || skills.length),
          source: 'skills-sh',
        }
      }
    } catch (err: unknown) {
      logger.warn({ err: getErrorMessage(err), url }, 'skills.sh search error')
    }
  }

  return { skills: [], total: 0, source: 'skills-sh' }
}

export async function fetchSkillsShSkill(
  slug: string
): Promise<{ content: string }> {
  const url = `${SKILLS_SH_API}/skills/${encodeURIComponent(slug)}/raw`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`skills.sh fetch failed (${res.status})`)
  const content = await res.text()
  return { content }
}
