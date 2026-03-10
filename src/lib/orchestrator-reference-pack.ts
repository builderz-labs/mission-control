import fs from 'node:fs'
import path from 'node:path'
import { config, ensureDirExists } from '@/lib/config'

type SuggestedReferenceFile = {
  path: string
  name: string
  reason: string
  priority: number
  source?: 'reference-pack' | 'learned-memory'
}

type LearningEntry = {
  ts: string
  source: 'orchestrator' | 'agent'
  scope: string
  summary: string
  task: string
  outcome: string
  files: string[]
  tags: string[]
}

const BEST_PRACTICE_NOTES = {
  contractFirst: 'Contract-first TypeScript: define shared shapes once and reuse them across route, lib, and UI layers.',
  additiveDesign: 'Additive architecture: extend existing flows and avoid refactoring unrelated working paths.',
  routeDiscipline: 'Thin route handlers: auth, parse request, delegate to lib, return stable JSON.',
  localFirst: 'Local-first operation: SQLite, local files, SSE/polling fallback, no external dependency requirement.',
  panelComposition: 'Small focused UI panels: keep container fetch logic separate from presentational components.',
  regressionSafety: 'Preserve behavior with focused tests around helper logic and normalization rules.',
}

function getMemoryRoot() {
  return config.memoryDir || path.join(config.dataDir, 'memory')
}

function getReferenceRoot() {
  return path.join(getMemoryRoot(), 'reference-packs', 'mission-control')
}

function getLearningRoot() {
  return path.join(getMemoryRoot(), 'learned-memory')
}

function getProjectLearningDir() {
  return path.join(getLearningRoot(), 'projects')
}

function getAgentLearningDir() {
  return path.join(getLearningRoot(), 'agents')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/^[a-z]:/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'workspace'
}

function shortTask(task: string, max = 140) {
  const normalized = task.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function deriveTags(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase()
  const candidates = ['dashboard', 'mission-control', 'api', 'agent', 'orchestrator', 'status', 'event', 'pipeline', 'heartbeat', 'token', 'review', 'patch', 'validate', 'task', 'memory', 'reference']
  return candidates.filter((candidate) => text.includes(candidate)).slice(0, 8)
}

function scoreTextOverlap(needle: string | undefined, haystack: string) {
  if (!needle?.trim()) return 0
  const terms = needle.toLowerCase().match(/[a-z0-9_-]{3,}/g) || []
  const target = haystack.toLowerCase()
  return terms.reduce((score, term) => score + (target.includes(term) ? 1 : 0), 0)
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function appendSection(filePath: string, section: string) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  fs.writeFileSync(filePath, `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${section}`, 'utf8')
}

export function ensureReferencePacks(projectRoot = process.cwd()) {
  const root = getReferenceRoot()
  ensureDirExists(root)

  const packs = [
    {
      fileName: '00-overview.md',
      title: 'Mission Control Reference Pack',
      body: [
        '# Mission Control Reference Pack',
        '',
        'Purpose: concise repo-specific guidance for orchestrator and agents.',
        '',
        'Best-practice anchors:',
        `- ${BEST_PRACTICE_NOTES.contractFirst}`,
        `- ${BEST_PRACTICE_NOTES.additiveDesign}`,
        `- ${BEST_PRACTICE_NOTES.routeDiscipline}`,
        `- ${BEST_PRACTICE_NOTES.localFirst}`,
        `- ${BEST_PRACTICE_NOTES.panelComposition}`,
        `- ${BEST_PRACTICE_NOTES.regressionSafety}`,
        '',
        'Use the narrower pack files below before loading raw source files.',
      ],
    },
    {
      fileName: '10-core-backend-pack.md',
      title: 'Core Backend Pack',
      body: [
        '# Core Backend Pack',
        '',
        'Standard / best practice:',
        `- ${BEST_PRACTICE_NOTES.contractFirst}`,
        `- ${BEST_PRACTICE_NOTES.routeDiscipline}`,
        `- ${BEST_PRACTICE_NOTES.localFirst}`,
        '',
        'Primary reference files:',
        `- ${path.join(projectRoot, 'src', 'types', 'mission-control.ts')} :: shared data contracts`,
        `- ${path.join(projectRoot, 'src', 'lib', 'mission-control-status.ts')} :: aggregation and inference layer`,
        `- ${path.join(projectRoot, 'src', 'app', 'api', 'status', 'route.ts')} :: viewer route shape`,
        `- ${path.join(projectRoot, 'src', 'app', 'api', 'orchestrator', 'route.ts')} :: operator action route`,
        `- ${path.join(projectRoot, 'src', 'lib', 'db.ts')} :: local persistence helpers`,
      ],
    },
    {
      fileName: '20-dashboard-ui-pack.md',
      title: 'Dashboard UI Pack',
      body: [
        '# Dashboard UI Pack',
        '',
        'Standard / best practice:',
        `- ${BEST_PRACTICE_NOTES.panelComposition}`,
        `- ${BEST_PRACTICE_NOTES.additiveDesign}`,
        '',
        'Primary reference files:',
        `- ${path.join(projectRoot, 'src', 'components', 'dashboard', 'mission-control-board.tsx')} :: container and layout`,
        `- ${path.join(projectRoot, 'src', 'components', 'dashboard', 'agent-status-board.tsx')} :: agent table conventions`,
        `- ${path.join(projectRoot, 'src', 'components', 'dashboard', 'event-stream-panel.tsx')} :: event rendering`,
        `- ${path.join(projectRoot, 'src', 'components', 'dashboard', 'pipeline-stage-panel.tsx')} :: compact workflow status`,
      ],
    },
    {
      fileName: '30-realtime-memory-pack.md',
      title: 'Realtime And Memory Pack',
      body: [
        '# Realtime And Memory Pack',
        '',
        'Standard / best practice:',
        '- Prefer SSE with polling fallback for UI freshness.',
        '- Keep memory compact and retrieval-friendly rather than storing full transcripts.',
        '- Store local learned summaries as markdown + json index for zero external dependency.',
        '',
        'Primary reference files:',
        `- ${path.join(projectRoot, 'src', 'app', 'api', 'events', 'route.ts')} :: event stream route`,
        `- ${path.join(projectRoot, 'src', 'lib', 'use-smart-poll.ts')} :: polling fallback pattern`,
        `- ${path.join(projectRoot, 'src', 'app', 'api', 'memory', 'route.ts')} :: local memory browser and file access`,
        `- ${path.join(projectRoot, 'src', 'app', 'api', 'agents', '[id]', 'heartbeat', 'route.ts')} :: heartbeat and token reporting`,
      ],
    },
    {
      fileName: '40-testing-pack.md',
      title: 'Testing Pack',
      body: [
        '# Testing Pack',
        '',
        'Standard / best practice:',
        `- ${BEST_PRACTICE_NOTES.regressionSafety}`,
        '',
        'Primary reference files:',
        `- ${path.join(projectRoot, 'src', 'lib', '__tests__', 'mission-control-status.test.ts')} :: helper behavior expectations`,
      ],
    },
  ]

  for (const pack of packs) {
    fs.writeFileSync(path.join(root, pack.fileName), `${pack.body.join('\n')}\n`, 'utf8')
  }

  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectRoot,
    packs: packs.map((pack) => ({
      fileName: pack.fileName,
      title: pack.title,
    })),
  }, null, 2), 'utf8')

  return packs.map((pack) => path.join(root, pack.fileName))
}

export function getReferencePackSuggestions(projectRoot = process.cwd()): SuggestedReferenceFile[] {
  const files = ensureReferencePacks(projectRoot)
  return files.map((filePath, index) => ({
    path: filePath,
    name: path.basename(filePath),
    reason: index === 0 ? '📚 Mission Control best-practice pack' : '🧭 Standard reference pack',
    priority: 12 + index,
    source: 'reference-pack',
  }))
}

export function getProjectMemoryPath(folder: string) {
  ensureDirExists(getProjectLearningDir())
  return path.join(getProjectLearningDir(), `${slugify(folder)}.md`)
}

function getProjectMemoryIndexPath(folder: string) {
  ensureDirExists(getProjectLearningDir())
  return path.join(getProjectLearningDir(), `${slugify(folder)}.json`)
}

function getAgentMemoryPath(agentName: string) {
  ensureDirExists(getAgentLearningDir())
  return path.join(getAgentLearningDir(), `${slugify(agentName)}.md`)
}

function readLearningIndex(filePath: string): LearningEntry[] {
  if (!fs.existsSync(filePath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed.entries as LearningEntry[] : []
  } catch {
    return []
  }
}

function writeLearningIndex(filePath: string, entries: LearningEntry[]) {
  fs.writeFileSync(filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    entries,
  }, null, 2), 'utf8')
}

export function writeProjectLearningMemory(input: {
  folder: string
  source: 'orchestrator' | 'agent'
  scope: string
  task: string
  summary: string
  outcome: string
  files?: string[]
}) {
  const memoryPath = getProjectMemoryPath(input.folder)
  const indexPath = getProjectMemoryIndexPath(input.folder)
  const files = uniqueStrings((input.files || []).map((filePath) => path.basename(filePath))).slice(0, 6)
  const entry: LearningEntry = {
    ts: new Date().toISOString(),
    source: input.source,
    scope: input.scope,
    summary: shortTask(input.summary, 160),
    task: shortTask(input.task, 180),
    outcome: shortTask(input.outcome, 160),
    files,
    tags: deriveTags(input.scope, input.task, input.summary, input.outcome),
  }

  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, [
      `# Learned Memory: ${input.scope}`,
      '',
      'Purpose: compact retrieval file for future runs. Load this before raw logs when similar work appears.',
      '',
      '## Stable Guidance',
      '- Prefer additive changes over unrelated refactors.',
      '- Reuse existing route, lib, and dashboard patterns before creating new abstractions.',
      '- Keep local-only operation and avoid external dependencies unless explicitly required.',
      '',
      '## Recent Learnings',
      '',
    ].join('\n'), 'utf8')
  }

  appendSection(memoryPath, [
    `### ${entry.ts}`,
    `- Source: ${entry.source}`,
    `- Task: ${entry.task}`,
    `- Summary: ${entry.summary}`,
    `- Outcome: ${entry.outcome}`,
    `- Files: ${files.length > 0 ? files.join(', ') : 'n/a'}`,
    `- Tags: ${entry.tags.join(', ') || 'general'}`,
    '',
  ].join('\n'))

  const existing = readLearningIndex(indexPath)
  const next = [entry, ...existing].slice(0, 40)
  writeLearningIndex(indexPath, next)

  return { markdownPath: memoryPath, indexPath }
}

export function writeAgentLearningMemory(input: {
  agentName: string
  task: string
  summary: string
  outcome: string
}) {
  const memoryPath = getAgentMemoryPath(input.agentName)
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, [
      `# Agent Memory: ${input.agentName}`,
      '',
      'Purpose: concise role memory to reduce prompt size on repeated work.',
      '',
      '## Reusable Patterns',
      '',
    ].join('\n'), 'utf8')
  }

  appendSection(memoryPath, [
    `### ${new Date().toISOString()}`,
    `- Task: ${shortTask(input.task, 180)}`,
    `- Summary: ${shortTask(input.summary, 160)}`,
    `- Outcome: ${shortTask(input.outcome, 160)}`,
    '',
  ].join('\n'))

  return memoryPath
}

export function getLearningMemorySuggestions(folder: string, taskContext?: string): SuggestedReferenceFile[] {
  const results: SuggestedReferenceFile[] = []
  const memoryPath = getProjectMemoryPath(folder)
  if (fs.existsSync(memoryPath)) {
    let priority = 8
    const indexEntries = readLearningIndex(getProjectMemoryIndexPath(folder))
    if (indexEntries.length > 0 && taskContext?.trim()) {
      const bestScore = Math.max(...indexEntries.map((entry) => scoreTextOverlap(taskContext, `${entry.task} ${entry.summary} ${entry.outcome} ${entry.tags.join(' ')}`)))
      priority = Math.max(4, 10 - bestScore)
    }
    results.push({
      path: memoryPath,
      name: path.basename(memoryPath),
      reason: '🧠 Learned project memory',
      priority,
      source: 'learned-memory',
    })
  }
  return results
}
