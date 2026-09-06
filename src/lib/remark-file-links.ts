/**
 * Remark plugin that turns workspace-relative file paths mentioned in
 * markdown (e.g. `docs/plans/x.md`, including backticked paths) into links
 * to the memory browser, which renders any allowed file by relative path.
 *
 * Deliberately conservative to avoid false positives:
 * - requires at least one directory separator and a file extension
 * - rejects URLs, absolute paths, Windows drive paths and `..` segments
 * - skips fenced code blocks, html and existing links/images
 */

import { visit } from 'unist-util-visit'
import type { Link, Parent, PhrasingContent, Root } from 'mdast'
import type { Plugin } from 'unified'

const PATH_SEGMENT = '[\\w@~+.-]+'
const FULL_PATH_RE = new RegExp(`^(?:${PATH_SEGMENT}/)+${PATH_SEGMENT}\\.[A-Za-z0-9]{1,16}$`)
// Lookbehind blocks matches glued to URLs (after `:` or `/`) or larger tokens.
const FIND_PATH_RE = new RegExp(
  `(?<![\\w/:@~+.-])((?:${PATH_SEGMENT}/)+${PATH_SEGMENT}\\.[A-Za-z0-9]{1,16})(?![\\w@~+./-])`,
  'g',
)

export function isFilePathToken(value: string): boolean {
  const v = (value || '').trim()
  if (!v) return false
  if (v.includes('..') || v.includes('://')) return false
  if (v.startsWith('/') || /^[A-Za-z]:/.test(v)) return false
  return FULL_PATH_RE.test(v)
}

export interface FilePathToken {
  type: 'text' | 'path'
  value: string
}

export function splitFilePathTokens(text: string): FilePathToken[] {
  if (!text) return [{ type: 'text', value: text }]
  const tokens: FilePathToken[] = []
  let lastIndex = 0
  for (const match of text.matchAll(FIND_PATH_RE)) {
    const candidate = match[1]
    const start = match.index ?? 0
    if (!isFilePathToken(candidate)) continue
    if (start > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, start) })
    tokens.push({ type: 'path', value: candidate })
    lastIndex = start + candidate.length
  }
  if (tokens.length === 0) return [{ type: 'text', value: text }]
  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) })
  return tokens
}

function fileUrl(path: string): string {
  return `/memory?path=${encodeURIComponent(path)}`
}

// Node types whose contents must never be linkified.
const SKIP_PARENT_TYPES = new Set(['link', 'linkReference', 'image', 'imageReference', 'definition'])

export function transformFileLinks(tree: Root): void {
  visit(tree, (node, index, parent: Parent | undefined) => {
    if (!parent || index == null || SKIP_PARENT_TYPES.has(parent.type)) return

    if (node.type === 'text') {
      const tokens = splitFilePathTokens((node as { value: string }).value)
      if (tokens.length === 1 && tokens[0].type === 'text') return
      const replacement: PhrasingContent[] = tokens.map((token) =>
        token.type === 'text'
          ? { type: 'text', value: token.value }
          : ({
              type: 'link',
              url: fileUrl(token.value),
              children: [{ type: 'text', value: token.value }],
            } as Link),
      )
      parent.children.splice(index, 1, ...replacement)
      // Continue after the freshly inserted nodes; their text children are
      // either plain text (already split) or inside a link (skipped above).
      return index + replacement.length
    }

    if (node.type === 'inlineCode') {
      const value = (node as { value: string }).value
      if (!isFilePathToken(value)) return
      const link = {
        type: 'link',
        url: fileUrl(value.trim()),
        children: [node],
      } as unknown as Link
      parent.children.splice(index, 1, link)
      return index + 1
    }
  })
}

export const remarkFileLinks: Plugin<[], Root> = () => {
  return (tree) => transformFileLinks(tree)
}
