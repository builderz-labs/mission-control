/**
 * Hermes Memory Scanner
 *
 * Read-only bridge that reads Hermes Agent's persistent memory files:
 * - ~/.hermes/memories/MEMORY.md — Agent's persistent memory (section-delimited entries)
 * - ~/.hermes/memories/USER.md — User profile memory
 *
 * Follows the same read-only pattern as other Hermes scanners.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import { logger } from './logger'

export interface HermesMemory {
  agentMemory: string | null
  userMemory: string | null
  agentMemorySize: number
  userMemorySize: number
  agentMemoryEntries: number
  userMemoryEntries: number
}

const MEMORY_DIR = () => join(config.homeDir, '.hermes', 'memories')

function countSectionEntries(content: string): number {
  if (!content) return 0
  // Count section delimiters (lines starting with or containing the section sign)
  const matches = content.match(/\u00A7/g)
  return matches ? matches.length : 0
}

function readMemoryFile(filePath: string): { content: string | null; size: number; entries: number } {
  if (!existsSync(filePath)) {
    return { content: null, size: 0, entries: 0 }
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    return {
      content,
      size: content.length,
      entries: countSectionEntries(content),
    }
  } catch {
    return { content: null, size: 0, entries: 0 }
  }
}

export function getHermesMemory(): HermesMemory {
  const memDir = MEMORY_DIR()

  try {
    const agent = readMemoryFile(join(memDir, 'MEMORY.md'))
    const user = readMemoryFile(join(memDir, 'USER.md'))

    return {
      agentMemory: agent.content,
      userMemory: user.content,
      agentMemorySize: agent.size,
      userMemorySize: user.size,
      agentMemoryEntries: agent.entries,
      userMemoryEntries: user.entries,
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read Hermes memory')
    return {
      agentMemory: null,
      userMemory: null,
      agentMemorySize: 0,
      userMemorySize: 0,
      agentMemoryEntries: 0,
      userMemoryEntries: 0,
    }
  }
}
