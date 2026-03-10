import 'server-only'

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ForgeAgent,
  ForgeChecklistCounts,
  ForgeDocStatus,
  ForgeModule,
  ForgeModuleWithDocs,
  ForgeOrchestratorSnapshot,
  ForgePlatformData,
  ForgeProject,
  ForgeWorkspaceScan,
} from '@/lib/forge/types'

const REQUIRED_DOCS = [
  'PRD.md',
  'SYSTEM_ARCHITECTURE.md',
  'TARGET_ARCHITECTURE.md',
  'TASKS.md',
  'RUNBOOK.md',
  'DECISIONS.md',
  'CHANGELOG_AI.md',
] as const

const repoRoot = process.cwd()

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content) as T
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function getChecklistCounts(filePath: string): Promise<ForgeChecklistCounts> {
  if (!(await fileExists(filePath))) {
    return { done: 0, open: 0 }
  }

  const content = await fs.readFile(filePath, 'utf8')
  return {
    done: (content.match(/^- \[x\]/gim) || []).length,
    open: (content.match(/^- \[ \]/gim) || []).length,
  }
}

async function getDocStatus(label: string, relativePath: string): Promise<ForgeDocStatus> {
  const docsPath = path.join(repoRoot, relativePath)
  const present: string[] = []
  const missing: string[] = []

  for (const fileName of REQUIRED_DOCS) {
    const exists = await fileExists(path.join(docsPath, fileName))
    if (exists) {
      present.push(fileName)
    } else {
      missing.push(fileName)
    }
  }

  return {
    label,
    path: relativePath.replace(/\\/g, '/'),
    present,
    missing,
    complete: missing.length === 0,
    checklist: await getChecklistCounts(path.join(docsPath, 'TASKS.md')),
  }
}

function pickSectionItems(content: string, heading: string) {
  const lines = content.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => line.trim() === heading)
  if (startIndex === -1) {
    return []
  }

  const items: string[] = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) {
      continue
    }
    if (line.startsWith('## ')) {
      break
    }
    if (line.startsWith('- ') || /^\d+\.\s/.test(line)) {
      items.push(line.replace(/^\d+\.\s/, '').replace(/^- /, '').trim())
    }
  }

  return items
}

async function getForgeOrchestratorSnapshot(): Promise<ForgeOrchestratorSnapshot> {
  const sourcePath = 'ai-orchestrator/index.js'
  const outputPath = 'ai-orchestrator/output'
  const reportJsonPath = path.join(repoRoot, outputPath, 'crew-output.json')
  const reportMarkdownPath = path.join(repoRoot, outputPath, '04-delivery_report_task.md')

  if (!(await fileExists(reportJsonPath))) {
    return {
      available: false,
      sourcePath,
      outputPath,
      generatedAt: null,
      reportTitle: 'No orchestrator output detected',
      recommendedImplementationPath: [],
      risks: [],
      verificationChecklist: [],
      nextAction: 'Run the local ai-orchestrator bridge to generate output artifacts.',
      taskOutputs: [],
      artifactFiles: [],
    }
  }

  const [reportJson, reportMarkdown, reportStat, outputEntries] = await Promise.all([
    readJsonFile<{
      raw?: string
      task_outputs?: Array<{ name: string; summary?: string; description?: string }>
    }>(reportJsonPath),
    fs.readFile(reportMarkdownPath, 'utf8').catch(() => ''),
    fs.stat(reportJsonPath),
    fs.readdir(path.join(repoRoot, outputPath)).catch(() => [] as string[]),
  ])

  const reportContent = reportMarkdown || reportJson.raw || ''

  return {
    available: true,
    sourcePath,
    outputPath,
    generatedAt: reportStat.mtime.toISOString(),
    reportTitle: reportContent.match(/^#\s+(.+)$/m)?.[1] ?? 'Final Orchestrator Report',
    recommendedImplementationPath: pickSectionItems(reportContent, '## Recommended Implementation Path'),
    risks: pickSectionItems(reportContent, '## Risks and Blockers'),
    verificationChecklist: pickSectionItems(reportContent, '## Verification Checklist'),
    nextAction:
      reportContent.match(/## Next Action for the Operator or Implementer\s+([\s\S]*?)(?:\n## |\s*$)/)?.[1]
        ?.replace(/\s+/g, ' ')
        .trim() ?? 'Review the orchestrator artifacts and continue the next implementation step.',
    taskOutputs: (reportJson.task_outputs ?? []).map((task) => ({
      name: task.name,
      summary: task.summary ?? 'No summary provided',
      description: task.description,
    })),
    artifactFiles: outputEntries.sort(),
  }
}

export async function getForgePlatformData(): Promise<ForgePlatformData> {
  const [projects, modules, agents, memoryIndex, workspaceScan, rootDocs, orchestrator] = await Promise.all([
    readJsonFile<ForgeProject[]>(path.join(repoRoot, 'marcuzx-forge', 'registry', 'projects.json')),
    readJsonFile<ForgeModule[]>(path.join(repoRoot, 'marcuzx-forge', 'registry', 'modules.json')),
    readJsonFile<ForgeAgent[]>(path.join(repoRoot, 'marcuzx-forge', 'agents', 'agents.json')),
    readJsonFile<Record<string, string[]>>(path.join(repoRoot, 'marcuzx-forge', 'memory', 'memory-index.json')),
    readJsonFile<ForgeWorkspaceScan>(path.join(repoRoot, 'marcuzx-forge', 'registry', 'workspace-scan.json')),
    getDocStatus('Repository', 'docs'),
    getForgeOrchestratorSnapshot(),
  ])

  const modulesWithDocs: ForgeModuleWithDocs[] = await Promise.all(
    modules.map(async (module) => ({
      ...module,
      docs: await getDocStatus(module.name, `${module.path}/docs`),
    }))
  )

  const memoryAssets = [...new Set(Object.values(memoryIndex).flat())]
  const totalOpenTasks = rootDocs.checklist.open + modulesWithDocs.reduce((sum, module) => sum + module.docs.checklist.open, 0)
  const totalCompletedTasks = rootDocs.checklist.done + modulesWithDocs.reduce((sum, module) => sum + module.docs.checklist.done, 0)

  return {
    brand: 'Marcuzx Forge',
    internalIdentity: 'Eak AI Factory',
    tagline: 'Where Systems Are Forged by AI',
    projects,
    agents,
    modules: modulesWithDocs,
    rootDocs,
    memoryAssets,
    registryFiles: [
      'marcuzx-forge/registry/projects.json',
      'marcuzx-forge/registry/projects.yaml',
      'marcuzx-forge/registry/modules.json',
      'marcuzx-forge/registry/workspace-scan.json',
    ],
    workspaceScan,
    orchestrator,
    totalOpenTasks,
    totalCompletedTasks,
  }
}
