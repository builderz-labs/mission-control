// @vitest-environment node
import Database from 'better-sqlite3'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildJevRepositoryContext } from '@/lib/jev-context'
import { JevRecordError } from '@/lib/jev-repository'
import { runMigrations } from '@/lib/migrations'

let db: InstanceType<typeof Database>
let root: string

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  root = mkdtempSync(join(homedir(), 'Dev', 'jev-context-test-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'README.md'), '# Example\nToken: sk-supersecret123456789\n')
  writeFileSync(join(root, 'package.json'), '{"name":"example","scripts":{"test":"vitest"}}')
  writeFileSync(join(root, '.env'), 'API_KEY=should-never-appear')
  writeFileSync(join(root, 'src', 'app.ts'), 'export const value = 1')
  db.prepare(`
    INSERT INTO projects (id,workspace_id,name,slug,description,ticket_prefix,github_repo)
    VALUES (81,1,'Example','example',?,'EX','owner/example')
  `).run(root)
})

afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('Jev repository context', () => {
  it('builds a bounded, redacted snapshot without credential files or raw source', () => {
    const context = buildJevRepositoryContext(1, 1, 81, db)
    const serialized = JSON.stringify(context)
    expect(context.source).toBe('local')
    expect(context.includedFiles).toEqual(expect.arrayContaining(['README.md', 'package.json']))
    expect(serialized).toContain('owner/example')
    expect(serialized).toContain('src/app.ts')
    expect(serialized).not.toContain('supersecret')
    expect(serialized).not.toContain('should-never-appear')
    expect(serialized).not.toContain('export const value')
  })

  it('falls back to project metadata when a path is outside the approved Dev root', () => {
    const outside = join(tmpdir(), 'untrusted-checkout')
    db.prepare('UPDATE projects SET description=? WHERE id=81').run(outside)
    const context = buildJevRepositoryContext(1, 1, 81, db)
    expect(context.source).toBe('project-metadata')
    expect(context.localAvailable).toBe(false)
    expect(context.warnings[0]).toMatch(/No safe local checkout/)
  })

  it('fails closed for a project outside the authenticated workspace', () => {
    db.prepare("INSERT INTO tenants (id,slug,display_name,linux_user,openclaw_home,workspace_root) VALUES (2,'two','Two','two','/tmp/two','/tmp/two')").run()
    db.prepare("INSERT INTO workspaces (id,slug,name,tenant_id) VALUES (2,'two','Two',2)").run()
    db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (82,2,'Two','two','TWO')").run()
    expect(() => buildJevRepositoryContext(1, 1, 82, db)).toThrow(JevRecordError)
  })
})
