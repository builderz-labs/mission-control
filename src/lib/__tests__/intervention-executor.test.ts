import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted — variables declared here are available in vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockExecSync,
  mockAcquireLock,
  mockReleaseLock,
  mockSyncClaudeSessions,
  mockLogAuditEvent,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn().mockReturnValue('main\n'),
  mockAcquireLock: vi.fn().mockReturnValue(true),
  mockReleaseLock: vi.fn(),
  mockSyncClaudeSessions: vi.fn().mockResolvedValue({ ok: true, message: 'synced' }),
  mockLogAuditEvent: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../config', () => ({
  config: {
    homeDir: '/home/testuser',
    projects: {
      adforge: '/home/testuser/ADFORGE',
      jobforge: '/home/testuser/JOBFORGE',
    },
  },
}))

vi.mock('../logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}))

vi.mock('../db', () => ({
  logAuditEvent: mockLogAuditEvent,
}))

vi.mock('../swarm-overlord', () => ({
  swarmOverlord: {
    acquireLock: mockAcquireLock,
    releaseLock: mockReleaseLock,
  },
}))

vi.mock('../claude-sessions', () => ({
  syncClaudeSessions: mockSyncClaudeSessions,
}))

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
  default: { execSync: mockExecSync },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { executeIntervention } from '../intervention-executor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = 'sess-abc-123'
const PROJECT_SLUG = 'adforge'
const ALLOWED_PATH = '/home/testuser/ADFORGE'
const DISALLOWED_PATH = '/tmp/evil-repo'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeIntervention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAcquireLock.mockReturnValue(true)
    mockSyncClaudeSessions.mockResolvedValue({ ok: true, message: 'synced' })
    mockExecSync.mockReturnValue('main\n')
  })

  // -------------------------------------------------------------------------
  // ROLLBACK
  // -------------------------------------------------------------------------

  describe('ROLLBACK', () => {
    it('rejects rollback when projectPath is not in the allowlist', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', DISALLOWED_PATH)

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/not within an allowed directory/i)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: DISALLOWED_PATH }),
        expect.any(String),
      )
      // Should NOT attempt git commands or lock acquisition
      expect(mockExecSync).not.toHaveBeenCalled()
      expect(mockAcquireLock).not.toHaveBeenCalled()
    })

    it('rejects rollback when projectPath is empty', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', '')

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/not within an allowed directory/i)
    })

    it('performs rollback on an allowed path', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', ALLOWED_PATH)

      expect(result.success).toBe(true)
      expect(result.message).toMatch(/Rollback successful/)
      expect(result.message).toContain('main')
      expect(mockAcquireLock).toHaveBeenCalledWith(ALLOWED_PATH, SESSION_ID, 'AEGIS_AUTO', 120)
      expect(mockExecSync).toHaveBeenCalledTimes(2) // git branch + git reset
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'intervention_rollback',
          actor: 'AEGIS_AUTO',
          target_type: 'session',
        }),
      )
      expect(mockReleaseLock).toHaveBeenCalledWith(ALLOWED_PATH, SESSION_ID)
    })

    it('aborts rollback when lock cannot be acquired', async () => {
      mockAcquireLock.mockReturnValue(false)

      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', ALLOWED_PATH)

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/Resource currently locked/i)
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('returns failure and releases lock when git command throws', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('git reset failed: not a git repo')
      })

      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', ALLOWED_PATH)

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/Rollback failed/i)
      expect(result.details).toMatch(/not a git repo/)
      // Lock must still be released in the finally block
      expect(mockReleaseLock).toHaveBeenCalledWith(ALLOWED_PATH, SESSION_ID)
    })

    it('allows rollback for paths under homeDir (not just explicit project roots)', async () => {
      const subPath = '/home/testuser/some-other-project'
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'ROLLBACK', subPath)

      expect(result.success).toBe(true)
      expect(result.message).toMatch(/Rollback successful/)
    })
  })

  // -------------------------------------------------------------------------
  // FORCE_SYNC
  // -------------------------------------------------------------------------

  describe('FORCE_SYNC', () => {
    it('delegates to syncClaudeSessions and returns success', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'FORCE_SYNC', ALLOWED_PATH)

      expect(result.success).toBe(true)
      expect(result.message).toMatch(/Force-Sync executed/i)
      expect(mockSyncClaudeSessions).toHaveBeenCalledWith(0)
    })

    it('returns failure when syncClaudeSessions throws', async () => {
      mockSyncClaudeSessions.mockRejectedValueOnce(new Error('scan exploded'))

      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'FORCE_SYNC', ALLOWED_PATH)

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/Force-sync failed/i)
      expect(result.details).toMatch(/scan exploded/)
    })
  })

  // -------------------------------------------------------------------------
  // HANDOFF
  // -------------------------------------------------------------------------

  describe('HANDOFF', () => {
    it('returns a stub success message', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'HANDOFF', ALLOWED_PATH)

      expect(result.success).toBe(true)
      expect(result.message).toMatch(/Handoff signal broadcasted/i)
      expect(result.details).toMatch(/sub-agent/i)
    })
  })

  // -------------------------------------------------------------------------
  // RESCAN
  // -------------------------------------------------------------------------

  describe('RESCAN', () => {
    it('delegates to FORCE_SYNC (calls syncClaudeSessions)', async () => {
      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'RESCAN', ALLOWED_PATH)

      expect(result.success).toBe(true)
      expect(result.message).toMatch(/Force-Sync executed/i)
      expect(mockSyncClaudeSessions).toHaveBeenCalledWith(0)
    })
  })

  // -------------------------------------------------------------------------
  // Unknown action
  // -------------------------------------------------------------------------

  describe('unknown action', () => {
    it('returns failure for an unrecognized action', async () => {
      const result = await executeIntervention(
        SESSION_ID,
        PROJECT_SLUG,
        'NUKE_FROM_ORBIT' as any,
        ALLOWED_PATH,
      )

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/Unknown intervention action/i)
      expect(result.message).toContain('NUKE_FROM_ORBIT')
    })
  })

  // -------------------------------------------------------------------------
  // Top-level error handling (outer try/catch in executeIntervention)
  // -------------------------------------------------------------------------

  describe('top-level error handling', () => {
    it('catches errors thrown inside action handlers and returns failure', async () => {
      // syncClaudeSessions throws synchronously -- performForceSync's inner
      // try/catch handles it and returns { success: false }
      mockSyncClaudeSessions.mockImplementationOnce(() => {
        throw new Error('unexpected sync crash')
      })

      const result = await executeIntervention(SESSION_ID, PROJECT_SLUG, 'FORCE_SYNC', ALLOWED_PATH)

      expect(result.success).toBe(false)
      expect(result.details).toMatch(/unexpected sync crash/)
    })
  })

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    it('logs the intervention start for every action', async () => {
      await executeIntervention(SESSION_ID, PROJECT_SLUG, 'HANDOFF', ALLOWED_PATH)

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          action: 'HANDOFF',
          projectSlug: PROJECT_SLUG,
        }),
        'Executing Aegis Intervention',
      )
    })
  })
})
