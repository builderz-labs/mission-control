import { logger } from './logger'

export interface ClusterNode {
  node_id: string
  url: string
  last_seen: number
  status: 'online' | 'offline'
}

/**
 * Aegis Cluster Manager.
 * Orchestrates multi-node discovery and distributed synchrony.
 */
class ClusterManager {
  private nodes: Map<string, ClusterNode> = new Map()
  private readonly HEARTBEAT_TIMEOUT = 30000 // 30 seconds

  constructor() {
    // In a real env, we might seed from ENV or a discovery service
    const seedNodes = process.env.AEGIS_PEER_NODES?.split(',') || []
    seedNodes.forEach(url => {
      const id = Buffer.from(url).toString('hex').slice(0, 8)
      this.nodes.set(id, { node_id: id, url, last_seen: Date.now(), status: 'online' })
    })
  }

  /**
   * Registers or updates a node in the cluster.
   */
  heartbeat(nodeId: string, url: string): void {
    const now = Date.now()
    this.nodes.set(nodeId, {
      node_id: nodeId,
      url,
      last_seen: now,
      status: 'online'
    })
    logger.debug({ nodeId, url }, 'Cluster heartbeat received')
  }

  /**
   * Returns all online peering nodes.
   */
  getPeers(): ClusterNode[] {
    const now = Date.now()
    return Array.from(this.nodes.values()).filter(node => {
      const isOnline = now - node.last_seen < this.HEARTBEAT_TIMEOUT
      if (!isOnline && node.status === 'online') {
        node.status = 'offline'
        logger.warn({ nodeId: node.node_id }, 'Cluster node went offline')
      }
      return isOnline
    })
  }

  /**
   * Broadcasts an event (e.g., a lock claim) to all peers.
   */
  async broadcast(path: string, payload: any): Promise<void> {
    const peers = this.getPeers()
    const promises = peers.map(async peer => {
      try {
        const res = await fetch(`${peer.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Aegis-Cluster-Key': process.env.CLUSTER_SECRET || '' },
          body: JSON.stringify(payload)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch (err) {
        logger.error({ err, peer: peer.url, path }, 'Broadcast to peer failed')
      }
    })
    await Promise.allSettled(promises)
  }
}

export const clusterManager = new ClusterManager()
