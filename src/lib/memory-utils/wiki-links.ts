/**
 * Wiki-link extraction utilities.
 *
 * Parses [[target]] and [[target|display]] syntax from markdown content,
 * returning structured link objects with line numbers for diagnostics.
 */

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

export interface WikiLink {
  target: string   // The linked-to file stem (e.g. "my-note")
  display: string  // Display text (alias or target)
  line: number     // 1-based line number
}

export function extractWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null
    // Re-create the regex per line to reset lastIndex
    const re = new RegExp(WIKI_LINK_RE.source, WIKI_LINK_RE.flags)
    while ((match = re.exec(lines[i])) !== null) {
      links.push({
        target: match[1].trim(),
        display: (match[2] || match[1]).trim(),
        line: i + 1,
      })
    }
  }
  return links
}
