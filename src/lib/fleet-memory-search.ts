import { searchMemory, rebuildIndex, type SearchResponse } from '@/lib/memory-search'
import { fleetMemoryRoots } from '@/lib/memory-roots'

export async function searchFleetMemory(query: string, limit = 20): Promise<SearchResponse> {
  const roots = fleetMemoryRoots()
  const combined: SearchResponse = {
    query,
    results: [],
    total: 0,
    indexedFiles: 0,
    indexedAt: null,
  }
  for (const root of roots) {
    const page = await searchMemory(root.root, root.prefixes, query, {
      limit,
      scope: `fleet:${root.id}`,
    })
    combined.indexedFiles += page.indexedFiles
    combined.indexedAt = page.indexedAt || combined.indexedAt
    for (const row of page.results) {
      combined.results.push({
        ...row,
        path: row.path.startsWith(`${root.id}/`) ? row.path : `${root.id}/${row.path}`,
      })
    }
  }
  combined.results.sort((a, b) => a.rank - b.rank)
  combined.results = combined.results.slice(0, limit)
  combined.total = combined.results.length
  return combined
}

export async function rebuildFleetMemoryIndex(): Promise<{ indexed: number; duration: number }> {
  const started = Date.now()
  let indexed = 0
  for (const root of fleetMemoryRoots()) {
    const result = await rebuildIndex(root.root, root.prefixes, `fleet:${root.id}`)
    indexed += result.indexed
  }
  return { indexed, duration: Date.now() - started }
}
