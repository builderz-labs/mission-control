/**
 * Classify memory markdown so health scoring does not treat session dumps
 * or skill docs as wiki notes.
 */

export type MemoryFileClass = 'compiled' | 'session' | 'skill-doc' | 'generated'

const SESSION_RE = /(^|\/)sessions\//
const SKILL_DOC_RE = /(^|\/)SKILL\.md$/i
const GENERATED_RE = /\.(json|jsonl)$/i

export function classifyMemoryPath(relativePath: string): MemoryFileClass {
  const normalized = relativePath.replace(/\\/g, '/')
  if (GENERATED_RE.test(normalized)) return 'generated'
  if (SESSION_RE.test(normalized)) return 'session'
  if (
    normalized.startsWith('Raw/')
    || normalized.startsWith('Schema/')
    || normalized.startsWith('graphify/')
    || normalized.includes('.claude/commands/')
  ) {
    return 'generated'
  }
  if (SKILL_DOC_RE.test(normalized)) return 'skill-doc'
  // Skill package internals (canonical ~/.agents/skills and vault .claude/skills)
  if (
    !normalized.startsWith('Wiki/')
    && !normalized.startsWith('_relay/')
    && !normalized.startsWith('Plan/')
    && normalized.includes('/')
  ) {
    return 'skill-doc'
  }
  return 'compiled'
}

export function isHealthScored(relativePath: string): boolean {
  return classifyMemoryPath(relativePath) === 'compiled'
}

export function extractFrontmatterBlock(content: string): string | null {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---', 4)
  return end === -1 ? null : content.slice(4, end)
}

/** True when YAML has description: or a non-empty tags field. */
export function hasDiscoverabilityField(content: string): boolean {
  const frontmatter = extractFrontmatterBlock(content)
  if (!frontmatter) return false
  if (/^description:\s*\S/m.test(frontmatter)) return true
  if (/^tags:\s*\S/m.test(frontmatter)) return true
  if (/^tags:\s*$/m.test(frontmatter) && /^\s+-\s+\S/m.test(frontmatter)) return true
  return false
}

export function fileStem(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}
