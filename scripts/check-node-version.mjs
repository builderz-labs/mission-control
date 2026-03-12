#!/usr/bin/env node

const SUPPORTED_NODE_MAJORS = [22, 24]

const current = process.versions.node
const currentMajor = Number.parseInt(current.split('.')[0] || '', 10)

if (!SUPPORTED_NODE_MAJORS.includes(currentMajor)) {
  const supported = SUPPORTED_NODE_MAJORS.map((major) => `${major}.x`).join(' or ')
  console.error(
    [
      `error: Mission Control supports Node ${supported}, but found ${current}.`,
      'use `nvm use 22` (recommended LTS) or `nvm use 24` before installing, building, or starting the app.',
    ].join('\n')
  )
  process.exit(1)
}
