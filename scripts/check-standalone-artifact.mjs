import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('.next/standalone')
const requiredFiles = [
  'server.js',
  'openapi.json',
  'ops/templates/openclaw-gateway@.service',
  'src/lib/schema.sql',
]
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
const forbiddenNames = [
  /^\.env(?:\.|$)/,
  /^playwright(?:\.|-)/,
  /^vitest\.config\./,
  /^eslint\.config\./,
  /^tsconfig(?:\.|-)/,
]

async function walk(directory, prefix = '', ignoredRoots = new Set()) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name)
    if (!prefix && ignoredRoots.has(entry.name)) continue
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative, ignoredRoots))
    else files.push(relative)
  }
  return files
}

await access(path.join(root, 'server.js')).catch(() => {
  throw new Error('Standalone artifact is missing; run `pnpm build` first')
})

const entries = await readdir(root)
// Dependencies and compiled Next output are intentionally opaque to this
// boundary check. Scanning them makes CI needlessly expensive; the release
// surfaces that could leak repository files are checked recursively below.
const files = await walk(root, '', new Set(['node_modules', '.next']))
const failures = []

for (const required of requiredFiles) {
  await access(path.join(root, required)).catch(() => {
    failures.push(`missing runtime file: ${required}`)
  })
}
for (const entry of entries) {
  if (!allowedRoots.has(entry)) failures.push(`unexpected root included: ${entry}`)
}
for (const file of files) {
  const basename = path.posix.basename(file)
  if (forbiddenNames.some((pattern) => pattern.test(basename))) {
    failures.push(`forbidden development file included: ${file}`)
  }
}

const allowedSourceFiles = new Set(['src/lib/schema.sql'])
for (const file of files.filter((candidate) => candidate.startsWith('src/'))) {
  if (!allowedSourceFiles.has(file)) failures.push(`unexpected source file included: ${file}`)
}

if (failures.length > 0) {
  throw new Error(`Standalone artifact boundary check failed:\n- ${failures.join('\n- ')}`)
}

console.log(JSON.stringify({
  artifact: '.next/standalone',
  boundaryFilesChecked: files.length,
  requiredFiles,
  status: 'ok',
}, null, 2))
