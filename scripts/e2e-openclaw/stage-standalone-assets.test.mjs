import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stageStandaloneAssets } from './stage-standalone-assets.mjs'

test('stages current static and public trees beside a nested standalone server', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-standalone-assets-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const serverRoot = path.join(root, '.next', 'standalone', 'workspace', 'app')
  const serverPath = path.join(serverRoot, 'server.js')

  fs.mkdirSync(path.join(root, '.next', 'static'), { recursive: true })
  fs.mkdirSync(path.join(root, 'public', 'brand'), { recursive: true })
  fs.mkdirSync(path.join(serverRoot, '.next', 'static'), { recursive: true })
  fs.mkdirSync(serverRoot, { recursive: true })
  fs.writeFileSync(serverPath, '')
  fs.writeFileSync(path.join(root, '.next', 'static', 'app.js'), 'current')
  fs.writeFileSync(path.join(root, 'public', 'brand', 'logo.png'), 'logo')
  fs.writeFileSync(path.join(serverRoot, '.next', 'static', 'stale.js'), 'stale')

  assert.equal(stageStandaloneAssets(root, serverPath), serverRoot)
  assert.equal(fs.readFileSync(path.join(serverRoot, '.next', 'static', 'app.js'), 'utf8'), 'current')
  assert.equal(fs.existsSync(path.join(serverRoot, '.next', 'static', 'stale.js')), false)
  assert.equal(fs.readFileSync(path.join(serverRoot, 'public', 'brand', 'logo.png'), 'utf8'), 'logo')
})

test('rejects a server outside the standalone build root', () => {
  assert.throws(
    () => stageStandaloneAssets('/repo', '/tmp/server.js'),
    /must be inside \.next\/standalone/,
  )
})
