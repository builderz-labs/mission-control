import { getDatabase } from './db'
import { logger } from './logger'
import { sovereignMemory } from './sovereign-memory'

export interface SwarmLock {
  resource_id: string
  session_id: string
  actor: string
  expires_at: number
}

/**
 * Aegis Swarm Overlord.
 * Manages fleet-wide resource locking and session prioritization.
 */
export const swarmOverlord = {
  /**
   * Acquires a lock on a shared resource (e.g., a project path or specific file).
   */
  acquireLock: (resourceId: string, sessionId: string, actor: string = 'AEGIS', ttlSeconds: number = 60): boolean => {
    try {
      const now = Math.floor(Date.now() / 1000)
      const expiresAt = now + ttlSeconds

      // Check for existing valid lock
      const currentLock = sovereignMemory.get<SwarmLock>(`lock:${resourceId}`)
      if (currentLock && currentLock.expires_at > now && currentLock.session_id !== sessionId) {
        logger.warn({ resourceId, sessionId, heldBy: currentLock.session_id }, 'Resource lock contention detected')
        return false
      }

      // Set new lock
      sovereignMemory.set(`lock:${resourceId}`, {
        resource_id: resourceId,
        session_id: sessionId,
        actor,
        expires_at: expiresAt
      })

      logger.info({ resourceId, sessionId }, 'Swarm lock acquired')
      return true
    } catch (err) {
      logger.error({ err, resourceId }, 'Failed to acquire swarm lock')
      return false
    }
  },

  /**
   * Releases a lock.
   */
  releaseLock: (resourceId: string, sessionId: string): void => {
    const currentLock = sovereignMemory.get<SwarmLock>(`lock:${resourceId}`)
    if (currentLock && currentLock.session_id === sessionId) {
      // In a real implementation, we might use a dedicated KV store or prune from SQLite.
      // For now, we "release" by setting to null or letting it expire.
      sovereignMemory.set(`lock:${resourceId}`, null)
      logger.info({ resourceId, sessionId }, 'Swarm lock released')
    }
  },

  /**
   * Gets the current status of all swarm members (active sessions).
   */
  getSwarmStatus: async () => {
    try {
      const db = getDatabase()
      const activeSessions = db.prepare('SELECT session_id, project_slug, last_message_at, is_anomaly FROM claude_sessions WHERE is_active = 1').all()
      
      const locks = sovereignMemory.listByProject('*') // Mocking global list
        .filter(m => m.key.startsWith('lock:'))
        .map(m => m.value as SwarmLock)

      return {
        member_count: activeSessions.length,
        members: activeSessions,
        active_locks: locks,
        timestamp: Math.floor(Date.now() / 1000)
      }
    } catch (err) {
      logger.error({ err }, 'Failed to get swarm status')
      return { member_count: 0, members: [], active_locks: [], error: 'Status retrieval failed' }
    }
  }
}
