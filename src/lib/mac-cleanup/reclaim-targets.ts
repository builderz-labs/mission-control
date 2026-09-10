import { homedir } from 'node:os'
import { join } from 'node:path'

export type IdleKind = 'npm' | 'pnpm' | 'yarn' | 'brew' | 'xcode' | 'bun' | 'uv' | 'docker' | null

export interface ReclaimAction {
  id: string
  path: string
  status: 'cleaned' | 'skipped' | 'deferred' | 'protected' | 'missing'
  reason: string
}

export interface ReclaimTarget {
  id: string
  label: string
  path: string
  idle: IdleKind
  kind: 'dir' | 'idle-children'
  childNames?: string[]
}

export function reclaimTargets(home = homedir()): ReclaimTarget[] {
  return [
    { id: 'npm-cache', label: 'npm cache', path: join(home, '.npm/_cacache'), idle: 'npm', kind: 'dir' },
    { id: 'pnpm-store', label: 'pnpm store', path: join(home, 'Library/pnpm/store'), idle: 'pnpm', kind: 'dir' },
    { id: 'yarn-cache', label: 'Yarn cache', path: join(home, 'Library/Caches/Yarn'), idle: 'yarn', kind: 'dir' },
    { id: 'homebrew', label: 'Homebrew cache', path: join(home, 'Library/Caches/Homebrew'), idle: 'brew', kind: 'dir' },
    { id: 'puppeteer', label: 'Puppeteer cache', path: join(home, '.cache/puppeteer'), idle: null, kind: 'dir' },
    { id: 'node-cache', label: 'Node cache', path: join(home, '.cache/node'), idle: null, kind: 'dir' },
    { id: 'codex-runtimes', label: 'Codex runtimes cache', path: join(home, '.cache/codex-runtimes'), idle: null, kind: 'dir' },
    { id: 'uv-cache', label: 'uv cache', path: join(home, '.cache/uv'), idle: 'uv', kind: 'dir' },
    { id: 'pip-cache', label: 'pip cache', path: join(home, 'Library/Caches/pip'), idle: 'uv', kind: 'dir' },
    { id: 'bun-cache', label: 'Bun cache', path: join(home, '.bun/install/cache'), idle: 'bun', kind: 'dir' },
    { id: 'xcode-derived', label: 'Xcode DerivedData', path: join(home, 'Library/Developer/Xcode/DerivedData'), idle: 'xcode', kind: 'dir' },
    {
      id: 'idle-dev',
      label: 'Idle Dev caches',
      path: join(home, 'Dev/_idle'),
      idle: null,
      kind: 'idle-children',
      childNames: ['node_modules', '.next', '.turbo', 'dist', 'coverage'],
    },
  ]
}

const IDLE_PATTERNS: Record<Exclude<IdleKind, null>, RegExp> = {
  npm: /(^|[\s/])(npm|npx|node-gyp|corepack)([\s/]|$)/,
  pnpm: /(^|[\s/])(pnpm|pnpx)([\s/]|$)/,
  yarn: /(^|[\s/])yarn([\s/]|$)/,
  brew: /(^|[\s/])brew([\s/]|$)/,
  xcode: /Xcode|xcodebuild/,
  bun: /(^|[\s/])bun([\s/]|$)/,
  uv: /(^|[\s/])(uv|pip)([\s/]|$)/,
  docker: /com\.docker|dockerd|docker desktop/i,
}

export function toolIsActive(kind: IdleKind, processSnapshot: string): boolean {
  if (!kind) return false
  return IDLE_PATTERNS[kind].test(processSnapshot.toLowerCase())
}
