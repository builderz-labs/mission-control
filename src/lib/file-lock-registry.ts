import { sovereignMemory } from './sovereign-memory'
import { logger } from './logger'

export interface FileLock {
  file_path: string
  session_id: string
  timestamp: number
}

/**
 * Aegis File-Lock Registry.
 * Tracks active file modifications to prevent multi-agent collisions.
 */
export const fileLockRegistry = {
  /**
   * Registers a file as being under modification by a session.
   */
  claim: (filePath: string, sessionId: string): boolean => {
    try {
      const locks = sovereignMemory.get<FileLock[]>('fleet:file_locks') || []
      
      // Check for existing claim
      const existing = locks.find(l => l.file_path === filePath)
      if (existing && existing.session_id !== sessionId) {
        logger.warn({ filePath, sessionId, holder: existing.session_id }, 'File lock contention')
        return false
      }

      // Add to registry if not already there
      if (!existing) {
        locks.push({ file_path: filePath, session_id: sessionId, timestamp: Date.now() })
        sovereignMemory.set('fleet:file_locks', locks)
        
        // Broadcast to cluster peers
        import('./cluster-manager').then(({ clusterManager }) => {
          clusterManager.broadcast('/api/cluster/lock/sync', { 
            type: 'FILE_CLAIM', 
            file_path: filePath, 
            session_id: sessionId 
          })
        })
      }

      return true
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to claim file lock')
      return false
    }
  },

  /**
   * Releases a file claim.
   */
  release: (filePath: string, sessionId: string): void => {
    try {
      let locks = sovereignMemory.get<FileLock[]>('fleet:file_locks') || []
      locks = locks.filter(l => !(l.file_path === filePath && l.session_id === sessionId))
      sovereignMemory.set('fleet:file_locks', locks)

      // Broadcast to cluster peers
      import('./cluster-manager').then(({ clusterManager }) => {
        clusterManager.broadcast('/api/cluster/lock/sync', { 
          type: 'FILE_RELEASE', 
          file_path: filePath, 
          session_id: sessionId 
        })
      })
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to release file lock')
    }
  },

  /**
   * Clears all locks for a session (e.g. on session close/crash).
   */
  clearSession: (sessionId: string): void => {
    try {
      let locks = sovereignMemory.get<FileLock[]>('fleet:file_locks') || []
      locks = locks.filter(l => l.session_id !== sessionId)
      sovereignMemory.set('fleet:file_locks', locks)
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to clear session locks')
    }
  }
}
