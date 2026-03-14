import { clusterManager } from './cluster-manager'
import { logger } from './logger'

type NodeRole = 'FOLLOWER' | 'CANDIDATE' | 'LEADER'

interface ConsensusState {
  currentTerm: number
  votedFor: string | null
  role: NodeRole
  leaderId: string | null
}

/**
 * Raft-lite Consensus Engine.
 * Manages cluster leader election to ensure sovereign orchestration consistency.
 * Uses lazy initialization to avoid timer leaks in serverless/build environments.
 */
class ConsensusEngine {
  private state: ConsensusState = {
    currentTerm: 0,
    votedFor: null,
    role: 'FOLLOWER',
    leaderId: null
  }

  private electionTimeout: NodeJS.Timeout | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private readonly nodeId = process.env.NODE_ID || `node-${Math.random().toString(16).slice(2, 6)}`
  private initialized = false

  /**
   * Start the consensus engine. Must be called explicitly — no timers on import.
   */
  start() {
    if (this.initialized) return
    this.initialized = true
    this.resetElectionTimeout()
    logger.info({ nodeId: this.nodeId }, 'Consensus engine started')
  }

  stop() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout)
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.electionTimeout = null
    this.heartbeatInterval = null
    this.initialized = false
  }

  private resetElectionTimeout() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout)
    const timeout = 1500 + Math.random() * 1500
    this.electionTimeout = setTimeout(() => this.startElection(), timeout)
  }

  private async startElection() {
    this.state.role = 'CANDIDATE'
    this.state.currentTerm++
    this.state.votedFor = this.nodeId
    logger.info({ term: this.state.currentTerm }, 'Starting leader election')

    const votes = await this.requestVotes()
    const majority = Math.floor(clusterManager.getPeers().length / 2) + 1

    if (votes >= majority) {
      this.becomeLeader()
    } else {
      this.state.role = 'FOLLOWER'
      this.resetElectionTimeout()
    }
  }

  private async requestVotes(): Promise<number> {
    const peers = clusterManager.getPeers()
    let votes = 1 // Vote for self

    const clusterSecret = process.env.CLUSTER_SECRET
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (clusterSecret) {
      headers['x-aegis-cluster-key'] = clusterSecret
    }

    const results = await Promise.allSettled(peers.map(peer =>
      fetch(`${peer.url}/api/cluster/consensus`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'VOTE_REQUEST',
          term: this.state.currentTerm,
          candidateId: this.nodeId
        })
      }).then(r => r.json())
    ))

    results.forEach(res => {
      if (res.status === 'fulfilled' && res.value.voteGranted) {
        votes++
      }
    })

    return votes
  }

  private becomeLeader() {
    this.state.role = 'LEADER'
    this.state.leaderId = this.nodeId
    logger.info({ term: this.state.currentTerm }, 'Elected as Cluster Leader')
    this.startHeartbeats()
  }

  private startHeartbeats() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout)
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(async () => {
      await clusterManager.broadcast('/api/cluster/consensus', {
        type: 'HEARTBEAT',
        term: this.state.currentTerm,
        leaderId: this.nodeId
      })
    }, 500)
  }

  public handleIncoming(payload: any): any {
    const { type, term, candidateId, leaderId } = payload

    if (term > this.state.currentTerm) {
      this.state.currentTerm = term
      this.state.votedFor = null
      this.state.role = 'FOLLOWER'
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    }

    if (type === 'VOTE_REQUEST') {
      const voteGranted = term >= this.state.currentTerm && (this.state.votedFor === null || this.state.votedFor === candidateId)
      if (voteGranted) {
        this.state.votedFor = candidateId
        this.resetElectionTimeout()
      }
      return { term: this.state.currentTerm, voteGranted }
    }

    if (type === 'HEARTBEAT') {
      if (term >= this.state.currentTerm) {
        this.state.leaderId = leaderId
        this.resetElectionTimeout()
      }
      return { success: true, term: this.state.currentTerm }
    }
  }

  public getStatus() {
    return { ...this.state, nodeId: this.nodeId }
  }
}

export const consensusEngine = new ConsensusEngine()
