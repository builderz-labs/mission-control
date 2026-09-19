import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { buildLinkGraph, extractWikiLinks } from '@/lib/memory-utils'
import { mkdir, readFile } from 'node:fs/promises'
import { logger } from '@/lib/logger'
import { isPathAllowed, resolveSafeMemoryPath } from '@/lib/memory-path'
import { resolveWorkspaceMemoryAccess } from '@/lib/workspace-isolation'
import { fleetMemoryRoots, locateMemoryPath, resolveSharedMemoryTarget } from '@/lib/memory-roots'

type LinkGraph = Awaited<ReturnType<typeof buildLinkGraph>>

function withPathPrefix(graph: LinkGraph, prefix: string): LinkGraph {
  if (!prefix) return graph
  const nodes: LinkGraph['nodes'] = {}
  for (const node of Object.values(graph.nodes)) {
    const path = `${prefix}${node.path}`
    nodes[path] = {
      ...node,
      path,
      // Keep wiki targets as bare names; only prefix concrete file paths already in the graph.
      outgoing: node.outgoing.map((target) => (graph.nodes[target] ? `${prefix}${target}` : target)),
      incoming: node.incoming.map((target) => (graph.nodes[target] ? `${prefix}${target}` : target)),
    }
  }
  return {
    ...graph,
    nodes,
  }
}

function mergeGraphs(graphs: LinkGraph[]): LinkGraph {
  const nodes: LinkGraph['nodes'] = {}
  let totalFiles = 0
  let totalLinks = 0
  for (const graph of graphs) {
    Object.assign(nodes, graph.nodes)
    totalFiles += graph.totalFiles
    totalLinks += graph.totalLinks
  }
  const orphans = Object.values(nodes)
    .filter((node) => node.outgoing.length === 0 && node.incoming.length === 0)
    .map((node) => node.path)
  return { nodes, totalFiles, totalLinks, orphans }
}

async function scanRoots(memoryAccess: { root: string; isolation: string }): Promise<Array<{ prefix: string; abs: string }>> {
  const roots = [{ prefix: '', abs: memoryAccess.root }]
  if (memoryAccess.isolation === 'shared') {
    const openclaw = fleetMemoryRoots().find((root) => root.id === 'openclaw')
    if (openclaw) {
      await mkdir(openclaw.root, { recursive: true })
      roots.push({ prefix: 'openclaw/', abs: openclaw.root })
    }
  }
  return roots
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  const memoryAccess = resolveWorkspaceMemoryAccess(auth.user)
  if (!memoryAccess) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const filePath = searchParams.get('file')

  try {
    if (filePath) {
      const located = locateMemoryPath(filePath)
      let fullPath: string
      let graphKey = filePath
      if (located?.root.id === 'openclaw') {
        const target = await resolveSharedMemoryTarget(filePath)
        if (!target?.rest) {
          return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
        }
        fullPath = target.abs
        graphKey = `openclaw/${located.rest}`
      } else {
        if (!isPathAllowed(filePath)) {
          return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
        }
        fullPath = await resolveSafeMemoryPath(memoryAccess.root, filePath)
      }

      const content = await readFile(fullPath, 'utf-8')
      const links = extractWikiLinks(content)

      const graphs: LinkGraph[] = []
      for (const root of await scanRoots(memoryAccess)) {
        const graph = await buildLinkGraph(root.abs)
        graphs.push(withPathPrefix(graph, root.prefix))
      }
      const graph = mergeGraphs(graphs)
      const node = graph.nodes[graphKey]
      const incoming = node?.incoming ?? []
      const outgoing = node?.outgoing ?? []

      return NextResponse.json({
        file: filePath,
        wikiLinks: links,
        outgoing,
        incoming,
      })
    }

    const graphs: LinkGraph[] = []
    for (const root of await scanRoots(memoryAccess)) {
      const graph = await buildLinkGraph(root.abs)
      graphs.push(withPathPrefix(graph, root.prefix))
    }
    const graph = mergeGraphs(graphs)

    const nodes = Object.values(graph.nodes).map((n) => ({
      path: n.path,
      name: n.name,
      outgoing: n.outgoing,
      incoming: n.incoming,
      linkCount: n.outgoing.length + n.incoming.length,
      hasSchema: n.schema !== null,
    }))

    return NextResponse.json({
      nodes,
      totalFiles: graph.totalFiles,
      totalLinks: graph.totalLinks,
      orphans: graph.orphans,
    })
  } catch (err) {
    logger.error({ err }, 'Memory links API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
