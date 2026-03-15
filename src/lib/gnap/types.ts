/**
 * GNAP (Git-Native Agent Protocol) Types
 * Based on https://github.com/farol-team/gnap
 */

/**
 * Protocol version
 */
export const GNAP_VERSION = "4";

/**
 * Agent type - AI or human
 */
export type GNAPAgentType = 'ai' | 'human';

/**
 * Agent status
 */
export type GNAPAgentStatus = 'active' | 'paused' | 'terminated';

/**
 * Task state
 */
export type GNAPTaskState =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'cancelled';

/**
 * Run state
 */
export type GNAPRunState = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Message type
 */
export type GNAPMessageType = 'directive' | 'status' | 'request' | 'info' | 'alert';

/**
 * Agent - a human or AI participant
 */
export interface GNAPAgent {
  id: string;
  name: string;
  role: string;
  type: GNAPAgentType;
  status: GNAPAgentStatus;
  runtime?: string; // openclaw, codex, claude, custom
  reports_to?: string; // Agent ID of manager
  heartbeat_sec?: number; // Poll interval in seconds
  contact?: Record<string, string>; // Platform handles (telegram, email, etc.)
  capabilities?: string[]; // Free-form capability tags
}

/**
 * Agents file - contains all agents
 */
export interface GNAPAgentsFile {
  agents: GNAPAgent[];
}

/**
 * Task comment
 */
export interface GNAPComment {
  by: string; // Agent ID
  at: string; // ISO 8601 timestamp
  text: string; // Comment text
}

/**
 * Task - a unit of work
 */
export interface GNAPTask {
  id: string; // Unique identifier (matches filename)
  title: string; // What needs to be done
  assigned_to: string[]; // Agent IDs responsible
  state: GNAPTaskState; // Task state
  priority: number; // 0 = highest priority
  created_by: string; // Agent ID who created it
  created_at: string; // ISO 8601 timestamp
  parent?: string; // Task ID of parent task
  desc?: string; // Longer description
  due?: string; // ISO 8601 deadline
  blocked?: boolean; // Is this blocked?
  blocked_reason?: string; // Why blocked
  reviewer?: string; // Agent ID who reviews
  updated_at?: string; // ISO 8601 last modified
  tags?: string[]; // Free-form labels
  comments?: GNAPComment[]; // Task comments
}

/**
 * Run - a single attempt to work on a task
 */
export interface GNAPRun {
  id: string; // Unique identifier (matches filename)
  task: string; // Task ID this run belongs to
  agent: string; // Agent ID who executed
  state: GNAPRunState; // Run state
  attempt: number; // Attempt number (1-based)
  started_at: string; // ISO 8601 when started
  finished_at?: string; // ISO 8601 when finished
  tokens?: { input: number; output: number }; // Token counts
  cost_usd?: number; // Cost of this run
  result?: string; // Human-readable outcome
  error?: string; // Error message if failed
  commits?: string[]; // Git commit SHAs produced
  artifacts?: string[]; // Paths to files produced
}

/**
 * Message - communication between agents
 */
export interface GNAPMessage {
  id: string; // Unique identifier
  from: string; // Sender agent ID
  to: string[]; // Recipient agent IDs. ["*"] = broadcast
  at: string; // ISO 8601 timestamp
  text: string; // Message content
  type?: GNAPMessageType; // Message type
  channel?: string; // Topic channel
  thread?: string; // Message ID this replies to
  read_by?: string[]; // Agent IDs who have read this
}

/**
 * Version file
 */
export interface GNAPVersionFile {
  version: string;
}

/**
 * GNAP repository configuration
 */
export interface GNAPConfig {
  repoPath: string;
  enabled: boolean;
  autoSync: boolean;
  syncIntervalSec: number;
  gitRemote?: string;
  gitBranch?: string;
}

/**
 * Sync statistics
 */
export interface GNAPSyncStats {
  lastSync: number;
  tasksToGNAP: number;
  tasksFromGNAP: number;
  agentsToGNAP: number;
  agentsFromGNAP: number;
  conflicts: number;
  errors: number;
}

/**
 * Git status
 */
export interface GitStatus {
  branch: string;
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Git log entry
 */
export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/**
 * Task filter options
 */
export interface GNAPTaskFilter {
  assigned_to?: string;
  state?: GNAPTaskState;
  priority?: number;
  tags?: string[];
  created_after?: string;
  created_before?: string;
  due_before?: string;
}

/**
 * Agent filter options
 */
export interface GNAPAgentFilter {
  type?: GNAPAgentType;
  status?: GNAPAgentStatus;
  role?: string;
  capabilities?: string[];
}
