#!/usr/bin/env node

const REQUIRED_NODE_VERSION = '22.22.0'

const current = process.versions.node
if (current !== REQUIRED_NODE_VERSION) {
  console.error(
    [
      `error: Mission Control requires Node ${REQUIRED_NODE_VERSION}, but found ${current}.`,
      'use `nvm use` (or your version manager equivalent) before installing, building, or starting the app.',
    ].join('\n')
  )
  process.exit(1)
}
