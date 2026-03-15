/**
 * GNAP Repository Operations
 * Handles git operations for GNAP repository
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/logger';
import { GNAPConfig, GitStatus, GitLogEntry, GNAP_VERSION } from './types';

export class GNAPRepo {
  constructor(private config: GNAPConfig) {}

  /**
   * Initialize GNAP repository
   */
  async init(): Promise<void> {
    logger.info({ path: this.config.repoPath }, 'Initializing GNAP repository');

    // Create repository directory if it doesn't exist
    if (!existsSync(this.config.repoPath)) {
      mkdirSync(this.config.repoPath, { recursive: true });
    }

    // Initialize git repo if needed
    const gitDir = join(this.config.repoPath, '.git');
    if (!existsSync(gitDir)) {
      logger.info('Initializing git repository');
      execSync('git init', { cwd: this.config.repoPath, stdio: 'pipe' });

      // Configure git
      execSync('git config user.name "Mission Control"', { cwd: this.config.repoPath, stdio: 'pipe' });
      execSync('git config user.email "mc@missioncontrol.local"', { cwd: this.config.repoPath, stdio: 'pipe' });
    }

    // Create .gnap directory if it doesn't exist
    const gnapDir = join(this.config.repoPath, '.gnap');
    if (!existsSync(gnapDir)) {
      mkdirSync(gnapDir, { recursive: true });
    }

    // Create subdirectories
    const subdirs = ['tasks', 'runs', 'messages'];
    for (const subdir of subdirs) {
      const dir = join(gnapDir, subdir);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Create version file
    const versionFile = join(gnapDir, 'version');
    if (!existsSync(versionFile)) {
      writeFileSync(versionFile, GNAP_VERSION);
      logger.info(`Created GNAP version file: ${GNAP_VERSION}`);
    } else {
      const existingVersion = readFileSync(versionFile, 'utf-8').trim();
      if (existingVersion !== GNAP_VERSION) {
        logger.warn(`GNAP version mismatch: expected ${GNAP_VERSION}, found ${existingVersion}`);
      }
    }

    // Create empty agents.json if it doesn't exist
    const agentsFile = join(gnapDir, 'agents.json');
    if (!existsSync(agentsFile)) {
      writeFileSync(agentsFile, JSON.stringify({ agents: [] }, null, 2));
      logger.info('Created empty agents.json');
    }

    // Initial commit if needed
    try {
      execSync('git rev-parse HEAD', { cwd: this.config.repoPath, stdio: 'pipe' });
    } catch {
      logger.info('Creating initial commit');
      this.execGit('add .');
      this.execGit('commit -m "Initial GNAP commit"');
    }

    logger.info('GNAP repository initialized successfully');
  }

  /**
   * Pull latest changes from remote
   */
  async pull(): Promise<void> {
    if (!this.config.gitRemote) {
      logger.debug('No git remote configured, skipping pull');
      return;
    }

    logger.info('Pulling from remote');
    try {
      this.execGit('pull --rebase', { timeout: 30000 });
      logger.info('Pull successful');
    } catch (error) {
      logger.error({ err: error }, 'Pull failed');
      throw new Error(`Git pull failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Push changes to remote
   */
  async push(message: string): Promise<void> {
    if (!this.config.gitRemote) {
      logger.debug('No git remote configured, skipping push');
      return;
    }

    logger.info({ message }, 'Pushing to remote');
    try {
      this.execGit('add .gnap/');
      this.execGit(`commit -m "${message.replace(/"/g, '\\"')}"`, { allowFailure: true });
      this.execGit('push', { timeout: 30000 });
      logger.info('Push successful');
    } catch (error) {
      logger.error({ err: error }, 'Push failed');
      throw new Error(`Git push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get git status
   */
  async status(): Promise<GitStatus> {
    const output = this.execGit('status --porcelain');
    const lines = output.split('\n').filter(l => l.trim());

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const path = line.substring(3).trim();

      if (status === '??') {
        untracked.push(path);
      } else if (status.startsWith('M ') || status.startsWith('A ')) {
        staged.push(path);
      } else if (status.startsWith(' M') || status.startsWith(' A')) {
        unstaged.push(path);
      } else {
        unstaged.push(path);
      }
    }

    let branch = this.config.gitBranch || 'main';
    try {
      const branchOutput = this.execGit('branch --show-current');
      if (branchOutput) {
        branch = branchOutput.trim();
      }
    } catch {
      // Use default branch
    }

    return {
      branch,
      hasChanges: lines.length > 0,
      staged,
      unstaged,
      untracked
    };
  }

  /**
   * Get git log
   */
  async log(count = 10): Promise<GitLogEntry[]> {
    const output = this.execGit(`log -${count} --pretty=format:"%H|%an|%ai|%s"`);
    const lines = output.split('\n').filter(l => l.trim());

    return lines.map(line => {
      const [hash, author, date, message] = line.split('|');
      return { hash, author, date, message };
    });
  }

  /**
   * Checkout branch
   */
  async checkout(branch?: string): Promise<void> {
    if (!branch) {
      branch = this.config.gitBranch || 'main';
    }
    logger.info({ branch }, 'Checking out branch');
    this.execGit(`checkout ${branch}`);
  }

  /**
   * Create and checkout new branch
   */
  async createBranch(branch: string): Promise<void> {
    logger.info({ branch }, 'Creating branch');
    this.execGit(`checkout -b ${branch}`);
  }

  /**
   * Merge branch
   */
  async merge(branch: string): Promise<void> {
    logger.info({ branch }, 'Merging branch');
    this.execGit(`merge ${branch}`);
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasChanges(): Promise<boolean> {
    const status = await this.status();
    return status.hasChanges;
  }

  /**
   * Check if there are merge conflicts
   */
  async hasConflicts(): Promise<boolean> {
    try {
      const output = this.execGit('diff --name-only --diff-filter=U');
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Resolve conflicts by choosing "theirs" or "ours"
   */
  async resolveConflicts(strategy: 'ours' | 'theirs' = 'theirs'): Promise<void> {
    logger.info({ strategy }, 'Resolving conflicts');

    // Get list of conflicted files
    const conflictedFiles = this.execGit('diff --name-only --diff-filter=U')
      .split('\n')
      .filter(f => f.trim() && f.startsWith('.gnap/'));

    for (const file of conflictedFiles) {
      const checkoutCmd = strategy === 'ours' ? '--ours' : '--theirs';
      this.execGit(`checkout ${checkoutCmd} -- "${file}"`);
      this.execGit(`add "${file}"`);
    }

    // Complete merge
    this.execGit('commit --no-edit');
    logger.info({ count: conflictedFiles.length }, 'Conflicts resolved');
  }

  /**
   * Reset to previous commit
   */
  async reset(commit?: string, hard = false): Promise<void> {
    const args = hard ? '--hard' : '--soft';
    const target = commit || 'HEAD~1';
    logger.info({ target, hard }, 'Resetting');
    this.execGit(`reset ${args} ${target}`);
  }

  /**
   * Revert commit
   */
  async revert(commit: string): Promise<void> {
    logger.info({ commit }, 'Reverting commit');
    this.execGit(`revert ${commit} --no-edit`);
  }

  /**
   * Get current commit hash
   */
  async getCurrentCommit(): Promise<string> {
    const output = this.execGit('rev-parse HEAD');
    return output.trim();
  }

  /**
   * Get remote URL
   */
  async getRemoteUrl(): Promise<string | null> {
    if (!this.config.gitRemote) {
      return null;
    }

    try {
      const output = this.execGit(`remote get-url ${this.config.gitRemote}`);
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Set remote URL
   */
  async setRemoteUrl(url: string): Promise<void> {
    if (!this.config.gitRemote) {
      throw new Error('No git remote configured');
    }

    logger.info({ remote: this.config.gitRemote, url }, 'Setting remote URL');
    this.execGit(`remote set-url ${this.config.gitRemote} ${url}`);
  }

  /**
   * Execute git command
   */
  private execGit(command: string, options: {
    allowFailure?: boolean;
    timeout?: number;
  } = {}): string {
    try {
      return execSync(`git ${command}`, {
        cwd: this.config.repoPath,
        stdio: 'pipe',
        timeout: options.timeout || 10000,
        encoding: 'utf-8'
      });
    } catch (error) {
      if (options.allowFailure) {
        return '';
      }
      logger.error({ err: error, command }, 'Git command failed');
      throw error;
    }
  }
}
