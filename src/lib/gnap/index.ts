/**
 * GNAP (Git-Native Agent Protocol) Library
 * Main exports
 */

export { GNAPRepo } from './repo';
export { GNAPTaskManager } from './task';
export { GNAPAgentManager } from './agent';

export type {
  GNAPAgent,
  GNAPAgentsFile,
  GNAPAgentType,
  GNAPAgentStatus,
  GNAPTask,
  GNAPTaskState,
  GNAPComment,
  GNAPRun,
  GNAPRunState,
  GNAPMessage,
  GNAPMessageType,
  GNAPVersionFile,
  GNAPConfig,
  GNAPSyncStats,
  GitStatus,
  GitLogEntry,
  GNAPTaskFilter,
  GNAPAgentFilter
} from './types';

export { GNAP_VERSION } from './types';

/**
 * Create GNAP repository instance
 */
export async function createGNAPRepo(config: {
  repoPath: string;
  gitRemote?: string;
  gitBranch?: string;
}): Promise<GNAPRepo> {
  const { GNAPRepo } = await import('./repo');
  const repo = new GNAPRepo({
    repoPath: config.repoPath,
    enabled: true,
    autoSync: false,
    syncIntervalSec: 300,
    gitRemote: config.gitRemote,
    gitBranch: config.gitBranch
  });
  await repo.init();
  return repo;
}

/**
 * Create GNAP task manager
 */
export function createGNAPTaskManager(repoPath: string): GNAPTaskManager {
  const { GNAPTaskManager } = require('./task');
  return new GNAPTaskManager(repoPath);
}

/**
 * Create GNAP agent manager
 */
export function createGNAPAgentManager(repoPath: string): GNAPAgentManager {
  const { GNAPAgentManager } = require('./agent');
  return new GNAPAgentManager(repoPath);
}
