import fs from 'node:fs'
import path from 'node:path'

function replaceTree(source, target) {
  if (!fs.existsSync(source)) return false
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
  return true
}

export function stageStandaloneAssets(repoRoot, serverPath) {
  const standaloneRoot = path.join(repoRoot, '.next', 'standalone')
  const relativeServer = path.relative(standaloneRoot, serverPath)
  if (relativeServer.startsWith('..') || path.isAbsolute(relativeServer)) {
    throw new Error('Standalone server must be inside .next/standalone')
  }

  const serverRoot = path.dirname(serverPath)
  replaceTree(
    path.join(repoRoot, '.next', 'static'),
    path.join(serverRoot, '.next', 'static'),
  )
  replaceTree(path.join(repoRoot, 'public'), path.join(serverRoot, 'public'))
  return serverRoot
}
