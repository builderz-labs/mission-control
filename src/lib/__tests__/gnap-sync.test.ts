import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  initGnapRepo,
  pushTaskToGnap,
  removeTaskFromGnap,
  pullTasksFromGnap,
  getGnapStatus,
  type McTask,
} from '../gnap-sync'

let tmpDir: string

beforeEach(() => {
  vi.stubEnv('GIT_AUTHOR_NAME', 'Mission Control Test')
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@mission-control.local')
  vi.stubEnv('GIT_COMMITTER_NAME', 'Mission Control Test')
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@mission-control.local')
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnap-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('initGnapRepo', () => {
  it('creates directory structure and initializes git', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)

    expect(fs.existsSync(path.join(repoPath, 'version'))).toBe(true)
    expect(fs.existsSync(path.join(repoPath, 'agents.json'))).toBe(true)
    expect(fs.existsSync(path.join(repoPath, 'tasks'))).toBe(true)
    expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true)

    expect(fs.readFileSync(path.join(repoPath, 'version'), 'utf-8').trim()).toBe('1')
  })

  it('is idempotent — re-running does not error', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)
    initGnapRepo(repoPath)

    expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true)
  })
})

describe('pushTaskToGnap', () => {
  it('writes task JSON and commits', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)

    const task: McTask = {
      id: 42,
      title: 'Test task',
      description: 'A test',
      status: 'in_progress',
      priority: 'high',
      assigned_to: 'agent-claude',
      tags: ['auth', 'sprint-1'],
      created_at: 1710500000,
      updated_at: 1710510000,
      project_id: 1,
    }

    pushTaskToGnap(task, repoPath)

    const filePath = path.join(repoPath, 'tasks', 'mc-42.json')
    expect(fs.existsSync(filePath)).toBe(true)

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(content.id).toBe('mc-42')
    expect(content.title).toBe('Test task')
    expect(content.state).toBe('in_progress')
    expect(content.priority).toBe('high')
    expect(content.assignee).toBe('agent-claude')
    expect(content.tags).toEqual(['auth', 'sprint-1'])
    expect(content.mc_id).toBe(42)
    expect(content.mc_project_id).toBe(1)

    // Verify it was committed
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: repoPath,
      encoding: 'utf-8',
    })
    expect(log).toContain('Update task mc-42')
  })

  it('handles string tags (JSON serialized)', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)

    const task: McTask = {
      id: 1,
      title: 'String tags task',
      status: 'pending',
      priority: 'low',
      tags: '["bug","fix"]',
    }

    pushTaskToGnap(task, repoPath)

    const content = JSON.parse(
      fs.readFileSync(path.join(repoPath, 'tasks', 'mc-1.json'), 'utf-8')
    )
    expect(content.tags).toEqual(['bug', 'fix'])
  })
})

describe('removeTaskFromGnap', () => {
  it('removes the task file and commits', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)

    const task: McTask = {
      id: 7,
      title: 'To be removed',
      status: 'done',
      priority: 'low',
    }
    pushTaskToGnap(task, repoPath)
    expect(fs.existsSync(path.join(repoPath, 'tasks', 'mc-7.json'))).toBe(true)

    removeTaskFromGnap(7, repoPath)
    expect(fs.existsSync(path.join(repoPath, 'tasks', 'mc-7.json'))).toBe(false)

    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: repoPath,
      encoding: 'utf-8',
    })
    expect(log).toContain('Remove task mc-7')
  })

  it('does nothing when task does not exist', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)
    // Should not throw
    removeTaskFromGnap(999, repoPath)
  })
})

describe('pullTasksFromGnap', () => {
  it('reads all task files from the repo', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)

    pushTaskToGnap({ id: 1, title: 'Task A', status: 'pending', priority: 'low' }, repoPath)
    pushTaskToGnap({ id: 2, title: 'Task B', status: 'done', priority: 'high' }, repoPath)

    const tasks = pullTasksFromGnap(repoPath)
    expect(tasks).toHaveLength(2)

    const ids = tasks.map(t => t.id).sort()
    expect(ids).toEqual(['mc-1', 'mc-2'])
  })

  it('returns empty array for non-existent directory', () => {
    const tasks = pullTasksFromGnap(path.join(tmpDir, 'nonexistent'))
    expect(tasks).toEqual([])
  })
})

describe('getGnapStatus', () => {
  it('reports uninitialized for empty directory', () => {
    const status = getGnapStatus(path.join(tmpDir, 'empty'))
    expect(status.initialized).toBe(false)
    expect(status.taskCount).toBe(0)
    expect(status.hasRemote).toBe(false)
  })

  it('reports correct status after init and push', () => {
    const repoPath = path.join(tmpDir, 'gnap-repo')
    initGnapRepo(repoPath)
    pushTaskToGnap({ id: 1, title: 'Task', status: 'pending', priority: 'medium' }, repoPath)

    const status = getGnapStatus(repoPath)
    expect(status.initialized).toBe(true)
    expect(status.taskCount).toBe(1)
    expect(status.hasRemote).toBe(false)
    expect(status.remoteUrl).toBe('')
  })
})
