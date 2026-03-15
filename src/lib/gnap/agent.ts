/**
 * GNAP Agent Operations
 * Handles agent registry operations
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/logger';
import { GNAPAgent, GNAPAgentsFile, GNAPAgentFilter } from './types';

export class GNAPAgentManager {
  constructor(private repoPath: string) {}

  /**
   * Get agents file
   */
  private async getAgentsFile(): Promise<GNAPAgentsFile> {
    try {
      const filePath = join(this.repoPath, '.gnap', 'agents.json');
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as GNAPAgentsFile;
    } catch (error) {
      logger.error({ err: error }, 'Failed to read agents file');
      return { agents: [] };
    }
  }

  /**
   * Write agents file
   */
  private async writeAgentsFile(file: GNAPAgentsFile): Promise<void> {
    const filePath = join(this.repoPath, '.gnap', 'agents.json');
    const content = JSON.stringify(file, null, 2);
    writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Get agent by ID
   */
  async getAgent(id: string): Promise<GNAPAgent | null> {
    const file = await this.getAgentsFile();
    return file.agents.find(a => a.id === id) || null;
  }

  /**
   * List all agents
   */
  async listAgents(): Promise<GNAPAgent[]> {
    const file = await this.getAgentsFile();
    return file.agents;
  }

  /**
   * Filter agents
   */
  async filterAgents(filter: GNAPAgentFilter): Promise<GNAPAgent[]> {
    const agents = await this.listAgents();

    return agents.filter(agent => {
      // Filter by type
      if (filter.type && agent.type !== filter.type) {
        return false;
      }

      // Filter by status
      if (filter.status && agent.status !== filter.status) {
        return false;
      }

      // Filter by role
      if (filter.role && agent.role !== filter.role) {
        return false;
      }

      // Filter by capabilities
      if (filter.capabilities && filter.capabilities.length > 0) {
        const agentCaps = agent.capabilities || [];
        const hasAllCaps = filter.capabilities.every(cap => agentCaps.includes(cap));
        if (!hasAllCaps) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Create agent
   */
  async createAgent(agent: GNAPAgent): Promise<void> {
    const file = await this.getAgentsFile();

    // Check if agent already exists
    if (file.agents.find(a => a.id === agent.id)) {
      throw new Error(`Agent ${agent.id} already exists`);
    }

    file.agents.push(agent);
    await this.writeAgentsFile(file);
    logger.info('Agent created', { id: agent.id, name: agent.name });
  }

  /**
   * Update agent
   */
  async updateAgent(agent: GNAPAgent): Promise<void> {
    const file = await this.getAgentsFile();
    const index = file.agents.findIndex(a => a.id === agent.id);

    if (index === -1) {
      throw new Error(`Agent ${agent.id} not found`);
    }

    file.agents[index] = agent;
    await this.writeAgentsFile(file);
    logger.info('Agent updated', { id: agent.id, name: agent.name });
  }

  /**
   * Delete agent
   */
  async deleteAgent(id: string): Promise<void> {
    const file = await this.getAgentsFile();
    const index = file.agents.findIndex(a => a.id === id);

    if (index === -1) {
      throw new Error(`Agent ${id} not found`);
    }

    file.agents.splice(index, 1);
    await this.writeAgentsFile(file);
    logger.info('Agent deleted', { id });
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(
    id: string,
    status: GNAPAgent['status']
  ): Promise<void> {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    agent.status = status;
    await this.updateAgent(agent);
    logger.info('Agent status updated', { id, status });
  }

  /**
   * Get agents by status
   */
  async getAgentsByStatus(status: GNAPAgent['status']): Promise<GNAPAgent[]> {
    return this.filterAgents({ status });
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(type: GNAPAgent['type']): Promise<GNAPAgent[]> {
    return this.filterAgents({ type });
  }

  /**
   * Get active agents
   */
  async getActiveAgents(): Promise<GNAPAgent[]> {
    return this.getAgentsByStatus('active');
  }

  /**
   * Get AI agents
   */
  async getAIAgents(): Promise<GNAPAgent[]> {
    return this.getAgentsByType('ai');
  }

  /**
   * Get human agents
   */
  async getHumanAgents(): Promise<GNAPAgent[]> {
    return this.getAgentsByType('human');
  }

  /**
   * Add capability to agent
   */
  async addCapability(id: string, capability: string): Promise<void> {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    if (!agent.capabilities) {
      agent.capabilities = [];
    }

    if (!agent.capabilities.includes(capability)) {
      agent.capabilities.push(capability);
      await this.updateAgent(agent);
      logger.info('Capability added to agent', { id, capability });
    }
  }

  /**
   * Remove capability from agent
   */
  async removeCapability(id: string, capability: string): Promise<void> {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    if (agent.capabilities) {
      agent.capabilities = agent.capabilities.filter(c => c !== capability);
      await this.updateAgent(agent);
      logger.info('Capability removed from agent', { id, capability });
    }
  }

  /**
   * Set agent last seen timestamp
   */
  async heartbeat(id: string): Promise<void> {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    // GNAP doesn't have last_seen, but we can track via runs
    logger.debug('Agent heartbeat', { id });
  }

  /**
   * Get agent's tasks
   */
  async getAgentTasks(id: string): Promise<GNAPAgent[]> {
    // This would need to query tasks
    // For now, return empty array
    return [];
  }

  /**
   * Batch create agents
   */
  async batchCreateAgents(agents: GNAPAgent[]): Promise<void> {
    const file = await this.getAgentsFile();

    for (const agent of agents) {
      if (file.agents.find(a => a.id === agent.id)) {
        logger.warn('Agent already exists, skipping', { id: agent.id });
        continue;
      }
      file.agents.push(agent);
    }

    await this.writeAgentsFile(file);
    logger.info('Batch agents created', { count: agents.length });
  }

  /**
   * Batch update agents
   */
  async batchUpdateAgents(agents: GNAPAgent[]): Promise<void> {
    const file = await this.getAgentsFile();

    for (const agent of agents) {
      const index = file.agents.findIndex(a => a.id === agent.id);
      if (index !== -1) {
        file.agents[index] = agent;
      }
    }

    await this.writeAgentsFile(file);
    logger.info('Batch agents updated', { count: agents.length });
  }

  /**
   * Count agents by status
   */
  async countAgentsByStatus(): Promise<Record<GNAPAgent['status'], number>> {
    const agents = await this.listAgents();

    const counts: Record<string, number> = {
      active: 0,
      paused: 0,
      terminated: 0
    };

    for (const agent of agents) {
      counts[agent.status]++;
    }

    return counts as Record<GNAPAgent['status'], number>;
  }

  /**
   * Count agents by type
   */
  async countAgentsByType(): Promise<Record<GNAPAgent['type'], number>> {
    const agents = await this.listAgents();

    const counts: Record<string, number> = {
      ai: 0,
      human: 0
    };

    for (const agent of agents) {
      counts[agent.type]++;
    }

    return counts as Record<GNAPAgent['type'], number>;
  }

  /**
   * Search agents
   */
  async searchAgents(query: string): Promise<GNAPAgent[]> {
    const agents = await this.listAgents();
    const lowerQuery = query.toLowerCase();

    return agents.filter(agent =>
      agent.name.toLowerCase().includes(lowerQuery) ||
      agent.role.toLowerCase().includes(lowerQuery) ||
      agent.capabilities?.some(cap => cap.toLowerCase().includes(lowerQuery))
    );
  }
}
