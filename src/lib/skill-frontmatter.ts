/** Parse SKILL.md YAML description without treating --- as prose. */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

export function parseSkillDescription(content: string): string | undefined {
  const frontmatter = FRONTMATTER_RE.exec(content)
  if (frontmatter) {
    const match = /^description:\s*(.*)$/m.exec(frontmatter[1])
    if (match) {
      let raw = match[1].trim().replace(/^["']|["']$/g, '')
      if (raw === '>' || raw === '>-' || raw === '|' || raw === '|-') {
        const lines = frontmatter[1].split('\n')
        const start = lines.findIndex((line) => /^description:\s*[>|]/.test(line))
        const folded: string[] = []
        for (const line of lines.slice(start + 1)) {
          if (!line.startsWith(' ') && line.trim()) break
          folded.push(line.trim())
        }
        raw = folded.join(' ').trim()
      }
      if (raw) return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw
    }
  }
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const first = lines.find((line) => !line.startsWith('#') && line !== '---' && !line.endsWith(':'))
  if (!first) return undefined
  return first.length > 220 ? `${first.slice(0, 217)}...` : first
}
