import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, openSync, readSync, realpathSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { getDatabase } from '@/lib/db'
import { assertJevProject } from '@/lib/jev-repository'
import { redactJevSetupText } from '@/lib/jev-setup-redaction'
import type { JevRepositoryContext } from '@/lib/jev-types'

const MAX_REFERENCE_BYTES = 12_000
const MAX_TOTAL_REFERENCE_BYTES = 64_000
const MAX_FILE_PATHS = 300
const REFERENCE_FILES = [
  'README.md', 'README', 'AGENTS.md', 'CLAUDE.md', 'package.json',
  'pnpm-workspace.yaml', 'pyproject.toml', 'requirements.txt', 'go.mod',
  'Cargo.toml', 'Gemfile', 'Dockerfile',
]
const BLOCKED_PATH = /(^|\/)(?:\.env[^/]*|credentials?|secrets?|auth(?:\.json)?|\.git)(?:$|\/)/i

interface ProjectRow {
  id: number
  workspace_id: number
  name: string
  slug: string
  description: string | null
  github_repo: string | null
  github_default_branch: string | null
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function projectRoot(project: ProjectRow, db: SqliteDatabase): string | null {
  const binding = db.prepare(`
    SELECT root_path FROM jev_project_checkouts
    WHERE project_id = ? AND workspace_id = ? LIMIT 1
  `).get(project.id, project.workspace_id) as { root_path: string } | undefined
  const raw = binding?.root_path
  if (!raw || !(raw.startsWith('~/Dev/') || raw.startsWith(`${homedir()}/Dev/`))) return null
  const expanded = raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : resolve(raw)
  const devRoot = resolve(homedir(), 'Dev')
  if (!inside(devRoot, expanded) || !existsSync(expanded)) return null
  try {
    const canonical = realpathSync(expanded)
    return inside(realpathSync(devRoot), canonical) ? canonical : null
  } catch {
    return null
  }
}

function git(root: string, args: string[]): string {
  try {
    return redactJevSetupText(execFileSync('git', args, {
      cwd: root, encoding: 'utf8', timeout: 3_000, maxBuffer: 512_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim())
  } catch {
    return ''
  }
}

function redactContext(text: string): string {
  return redactJevSetupText(text)
}

function readBoundedText(path: string, limit: number): string {
  const handle = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const bytes = readSync(handle, buffer, 0, limit, 0)
    return buffer.subarray(0, bytes).toString('utf8')
  } finally {
    closeSync(handle)
  }
}

function walkFiles(root: string, folder = '', depth = 0): string[] {
  if (depth > 4) return []
  const output: string[] = []
  for (const item of readdirSync(resolve(root, folder), { withFileTypes: true })) {
    const path = folder ? `${folder}/${item.name}` : item.name
    if (BLOCKED_PATH.test(path) || item.isSymbolicLink()) continue
    if (item.isFile()) output.push(path)
    else if (item.isDirectory() && !['node_modules', '.next', 'dist', 'build', 'coverage', 'vendor'].includes(item.name)) {
      output.push(...walkFiles(root, path, depth + 1))
    }
    if (output.length >= MAX_FILE_PATHS) break
  }
  return output
}

function safePaths(root: string): string[] {
  const tracked = git(root, ['ls-files', '--cached', '--others', '--exclude-standard'])
  const fallback = tracked ? [] : walkFiles(root)
  return (tracked ? tracked.split('\n') : fallback)
    .map((path) => path.trim()).filter((path) => path && !BLOCKED_PATH.test(path))
    .slice(0, MAX_FILE_PATHS)
}

function referenceContent(root: string): { files: Record<string, string>; included: string[] } {
  const files: Record<string, string> = {}
  const included: string[] = []
  let remaining = MAX_TOTAL_REFERENCE_BYTES
  for (const name of REFERENCE_FILES) {
    const path = resolve(root, name)
    if (remaining <= 0 || !inside(root, path) || !existsSync(path)) continue
    try {
      if (!lstatSync(path).isFile() || realpathSync(path) !== path) continue
      const content = readBoundedText(path, Math.min(remaining, MAX_REFERENCE_BYTES))
      files[name] = redactContext(content)
      remaining -= content.length
      included.push(name)
    } catch {
      continue
    }
  }
  return { files, included }
}

function languageSummary(paths: string[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const path of paths) {
    const extension = extname(path).toLowerCase() || '[none]'
    totals[extension] = (totals[extension] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 12))
}

export function buildJevRepositoryContext(
  workspaceId: number,
  tenantId: number,
  projectId: number,
  db: SqliteDatabase = getDatabase(),
  mode: 'safe_repository' | 'metadata_only' = 'safe_repository',
): JevRepositoryContext {
  assertJevProject(workspaceId, tenantId, projectId, db)
  const project = db.prepare(`
    SELECT id,workspace_id,name,slug,description,github_repo,github_default_branch
    FROM projects WHERE id=? AND workspace_id=?
  `).get(projectId, workspaceId) as ProjectRow
  const root = projectRoot(project, db)
  const repository = {
    name: redactContext(project.name), slug: redactContext(project.slug),
    github: project.github_repo ? redactContext(project.github_repo) : null,
    defaultBranch: redactContext(project.github_default_branch || 'main'),
  }
  if (mode === 'metadata_only') return {
    source: 'project-metadata', localAvailable: Boolean(root), includedFiles: [], trackedFileCount: 0,
    warnings: ['Policy permits project metadata only; no checkout files were read.'],
    state: { repository, purpose: redactContext(project.description || 'No project description is available.') },
  }
  if (!root) return {
    source: 'project-metadata', localAvailable: false, includedFiles: [], trackedFileCount: 0,
    warnings: ['No safe local checkout was found; using Mission Control project metadata only.'],
    state: { repository, purpose: redactContext(project.description || 'No project description is available.') },
  }

  const paths = safePaths(root)
  const references = referenceContent(root)
  const status = git(root, ['status', '--short', '--untracked-files=no']).split('\n')
    .filter((line) => line && !BLOCKED_PATH.test(line.slice(3))).slice(0, 100)
  return {
    source: 'local', localAvailable: true, includedFiles: references.included,
    trackedFileCount: paths.length, warnings: [],
    state: {
      repository,
      workingTree: { branch: git(root, ['branch', '--show-current']) || 'detached', changedFiles: status },
      structure: { representativeFiles: paths.slice(0, 200), extensions: languageSummary(paths) },
      referenceFiles: references.files,
      privacy: 'Allowlisted documentation and manifest files only; credential files and raw source are excluded.',
    },
  }
}
