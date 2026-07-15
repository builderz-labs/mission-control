import { access, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('.next/standalone')
const sourceRoot = path.join(root, 'src')
const schemaPath = path.join(sourceRoot, 'lib', 'schema.sql')
const allowedRoots = new Set([
  '.next',
  'messages',
  'node_modules',
  'openapi.json',
  'ops',
  'package.json',
  'public',
  'server.js',
  'src',
])

await access(path.join(root, 'server.js')).catch(() => {
  throw new Error('Standalone artifact is missing; run `pnpm build` first')
})
await access(schemaPath).catch(() => {
  throw new Error('Standalone artifact is missing the runtime database schema')
})

for (const entry of await readdir(root)) {
  if (!allowedRoots.has(entry)) await rm(path.join(root, entry), { recursive: true, force: true })
}

// The server executes compiled output. The SQL schema is the only raw source
// file read at runtime, so remove every other source file from the release.
for (const entry of await readdir(sourceRoot)) {
  if (entry !== 'lib') await rm(path.join(sourceRoot, entry), { recursive: true, force: true })
}
for (const entry of await readdir(path.join(sourceRoot, 'lib'))) {
  if (entry !== 'schema.sql') await rm(path.join(sourceRoot, 'lib', entry), { recursive: true, force: true })
}
for (const entry of await readdir(path.join(root, 'ops'))) {
  if (entry !== 'templates') await rm(path.join(root, 'ops', entry), { recursive: true, force: true })
}
for (const entry of await readdir(path.join(root, 'ops', 'templates'))) {
  if (entry !== 'openclaw-gateway@.service') {
    await rm(path.join(root, 'ops', 'templates', entry), { recursive: true, force: true })
  }
}
await mkdir(path.dirname(schemaPath), { recursive: true })

console.log('Prepared standalone artifact with release-only repository files')
