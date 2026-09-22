import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AutomationId, MutationClass, ResourceKind } from './types'

export interface CatalogEntry {
  id: AutomationId
  label: string
  launchdLabel: string
  relativeBinary: string
  mutationClass: MutationClass
  resources: ResourceKind[]
  intervalSeconds: number | null
  triggerable: boolean
  notes: string[]
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'safe-reclaim',
    label: 'Safe reclaim',
    launchdLabel: 'com.tylerdevries.mac-safe-reclaim',
    relativeBinary: '.local/libexec/mac-resource-guardian/mac-safe-reclaim',
    mutationClass: 'cache',
    resources: ['cpu', 'ram', 'disk'],
    intervalSeconds: 1800,
    triggerable: true,
    notes: [
      'Clears regenerable caches and idle Dev/_idle build folders.',
      'Skips every project with a live working directory, plus Work and agent homes.',
      'Stops high-CPU node-gyp/webpack/esbuild workers only when their cwd is under Dev/_idle.',
    ],
  },
  {
    id: 'resource-guardian',
    label: 'Resource guardian',
    launchdLabel: 'com.tylerdevries.mac-resource-guardian',
    relativeBinary: '.local/libexec/mac-resource-guardian/mac-resource-guardian',
    mutationClass: 'observe',
    resources: ['cpu', 'ram', 'disk'],
    intervalSeconds: 60,
    triggerable: true,
    notes: [
      'Observation only: notifies on CPU/RAM/disk pressure and never kills processes or purges RAM.',
    ],
  },
  {
    id: 'storage-maintenance',
    label: 'Storage maintenance',
    launchdLabel: 'com.tylerdevries.mac-storage-maintenance',
    relativeBinary: '.local/libexec/mac-resource-guardian/mac-storage-maintenance',
    mutationClass: 'cache',
    resources: ['disk'],
    intervalSeconds: 21600,
    triggerable: true,
    notes: [
      'Mutates only idle npm/pnpm caches after ownership and symlink checks.',
      'Launchd ExitTimeOut is 30s while the script timeout is 600s, so real prunes can be killed mid-run.',
    ],
  },
  {
    id: 'clean-mac',
    label: 'clean-mac healthcheck',
    launchdLabel: 'com.tylerdevries.clean-mac',
    relativeBinary: '.local/bin/clean-mac-safe',
    mutationClass: 'alias',
    resources: ['disk'],
    intervalSeconds: 300,
    triggerable: false,
    notes: [
      'LaunchAgent runs --healthcheck, not a clean. It overlaps the storage job.',
    ],
  },
  {
    id: 'clean-ram',
    label: 'clean-ram healthcheck',
    launchdLabel: 'com.tylerdevries.clean-ram',
    relativeBinary: '.local/bin/clean-ram-safe',
    mutationClass: 'alias',
    resources: ['ram'],
    intervalSeconds: 60,
    triggerable: false,
    notes: [
      'RAM purge is disabled. This job only healthchecks the guardian every 60s.',
    ],
  },
  {
    id: 'safe-disk-maintenance',
    label: 'Legacy disk maintenance',
    launchdLabel: 'com.tylerdevries.safe-disk-maintenance',
    relativeBinary: '.local/bin/safe-disk-maintenance',
    mutationClass: 'aggressive',
    resources: ['disk', 'ram'],
    intervalSeconds: 900,
    triggerable: false,
    notes: [
      'Deletes caches and runs docker prune -af. Mission Control will not trigger it.',
    ],
  },
]

export function catalogBinary(entry: CatalogEntry, home = homedir()): string {
  return join(home, entry.relativeBinary)
}
