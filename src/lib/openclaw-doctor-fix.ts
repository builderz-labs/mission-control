import fs from 'node:fs'
import path from 'node:path'

export interface OpenClawDoctorFixResult {
  archivedOrphans: number
  storesScanned: number
}

function formatArchiveTimestamp(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().replaceAll(':', '-')
}

function isPrimaryTranscriptFile(fileName: string): boolean {
  return fileName !== 'sessions.json' && fileName.endsWith('.jsonl')
}

function collectReferencedTranscriptNames(store: Record<string, unknown>): Set<string> {
  const referenced = new Set<string>()

  for (const entry of Object.values(store)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>

    if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
      referenced.add(`${record.sessionId.trim()}.jsonl`)
    }

    if (typeof record.sessionFile === 'string' && record.sessionFile.trim()) {
      const sessionFileName = path.basename(record.sessionFile.trim())
      if (isPrimaryTranscriptFile(sessionFileName)) {
        referenced.add(sessionFileName)
      }
    }
  }

  return referenced
}

export function archiveOrphanTranscriptsForStateDir(stateDir: string): OpenClawDoctorFixResult {
  const agentsDir = path.join(stateDir, 'agents')
  if (!fs.existsSync(agentsDir)) {
    return { archivedOrphans: 0, storesScanned: 0 }
  }

  let archivedOrphans = 0
  let storesScanned = 0

  for (const agentName of fs.readdirSync(agentsDir)) {
    const sessionsDir = path.join(agentsDir, agentName, 'sessions')
    const sessionsFile = path.join(sessionsDir, 'sessions.json')
    if (!fs.existsSync(sessionsFile)) continue

    storesScanned += 1

    let store: Record<string, unknown>
    try {
      store = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }

    const referenced = collectReferencedTranscriptNames(store)
    const archiveTimestamp = formatArchiveTimestamp()

    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isPrimaryTranscriptFile(entry.name)) continue
      if (referenced.has(entry.name)) continue

      const sourcePath = path.join(sessionsDir, entry.name)
      const archivePath = `${sourcePath}.deleted.${archiveTimestamp}`
      fs.renameSync(sourcePath, archivePath)
      archivedOrphans += 1
    }
  }

  return { archivedOrphans, storesScanned }
}
