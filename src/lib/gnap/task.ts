/**
 * GNAP Task Operations
 * Handles task CRUD operations
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/logger';
import { GNAPTask, GNAPComment, GNAPTaskFilter } from './types';

export class GNAPTaskManager {
  constructor(private repoPath: string) {}

  /**
   * Get task by ID
   */
  async getTask(id: string): Promise<GNAPTask | null> {
    try {
      const filePath = join(this.repoPath, '.gnap', 'tasks', `${id}.json`);
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as GNAPTask;
    } catch (error) {
      logger.debug({ err: error, id }, 'Failed to read task');
      return null;
    }
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<GNAPTask[]> {
    const tasksDir = join(this.repoPath, '.gnap', 'tasks');

    try {
      const files = readdirSync(tasksDir)
        .filter(f => f.endsWith('.json'))
        .sort(); // Sort by filename (which should be task ID)

      return files.map(f => {
        const content = readFileSync(join(tasksDir, f), 'utf-8');
        return JSON.parse(content) as GNAPTask;
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list tasks');
      return [];
    }
  }

  /**
   * Filter tasks
   */
  async filterTasks(filter: GNAPTaskFilter): Promise<GNAPTask[]> {
    const tasks = await this.listTasks();

    return tasks.filter(task => {
      // Filter by assignee
      if (filter.assigned_to && !task.assigned_to.includes(filter.assigned_to)) {
        return false;
      }

      // Filter by state
      if (filter.state && task.state !== filter.state) {
        return false;
      }

      // Filter by priority
      if (filter.priority !== undefined && task.priority !== filter.priority) {
        return false;
      }

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        const taskTags = task.tags || [];
        const hasAllTags = filter.tags.every(tag => taskTags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      // Filter by creation date
      if (filter.created_after && task.created_at < filter.created_after) {
        return false;
      }
      if (filter.created_before && task.created_at > filter.created_before) {
        return false;
      }

      // Filter by due date
      if (filter.due_before && task.due && task.due > filter.due_before) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create task
   */
  async createTask(task: GNAPTask): Promise<void> {
    const filePath = join(this.repoPath, '.gnap', 'tasks', `${task.id}.json`);
    const content = JSON.stringify(task, null, 2);
    writeFileSync(filePath, content, 'utf-8');
    logger.info({ id: task.id, title: task.title }, 'Task created');
  }

  /**
   * Update task
   */
  async updateTask(task: GNAPTask): Promise<void> {
    await this.createTask(task); // Overwrite
    logger.info({ id: task.id, title: task.title }, 'Task updated');
  }

  /**
   * Delete task
   */
  async deleteTask(id: string): Promise<void> {
    const filePath = join(this.repoPath, '.gnap', 'tasks', `${id}.json`);
    unlinkSync(filePath);
    logger.info({ id }, 'Task deleted');
  }

  /**
   * Update task state
   */
  async updateTaskState(
    id: string,
    newState: GNAPTask['state'],
    agentId: string
  ): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    task.state = newState;
    task.updated_at = new Date().toISOString();

    await this.updateTask(task);
    logger.info({ id, newState, agentId }, 'Task state updated');
  }

  /**
   * Assign task to agent
   */
  async assignTask(id: string, agentId: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (!task.assigned_to.includes(agentId)) {
      task.assigned_to.push(agentId);
      task.updated_at = new Date().toISOString();

      await this.updateTask(task);
      logger.info({ id, agentId }, 'Task assigned');
    }
  }

  /**
   * Unassign task from agent
   */
  async unassignTask(id: string, agentId: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    task.assigned_to = task.assigned_to.filter(a => a !== agentId);
    task.updated_at = new Date().toISOString();

    await this.updateTask(task);
    logger.info({ id, agentId }, 'Task unassigned');
  }

  /**
   * Add comment to task
   */
  async addComment(
    id: string,
    comment: GNAPComment
  ): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (!task.comments) {
      task.comments = [];
    }

    task.comments.push(comment);
    task.updated_at = new Date().toISOString();

    await this.updateTask(task);
    logger.info({ id, author: comment.by }, 'Comment added to task');
  }

  /**
   * Add tag to task
   */
  async addTag(id: string, tag: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (!task.tags) {
      task.tags = [];
    }

    if (!task.tags.includes(tag)) {
      task.tags.push(tag);
      task.updated_at = new Date().toISOString();

      await this.updateTask(task);
      logger.info({ id, tag }, 'Tag added to task');
    }
  }

  /**
   * Remove tag from task
   */
  async removeTag(id: string, tag: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.tags) {
      task.tags = task.tags.filter(t => t !== tag);
      task.updated_at = new Date().toISOString();

      await this.updateTask(task);
      logger.info({ id, tag }, 'Tag removed from task');
    }
  }

  /**
   * Get tasks assigned to agent
   */
  async getTasksForAgent(agentId: string): Promise<GNAPTask[]> {
    return this.filterTasks({ assigned_to: agentId });
  }

  /**
   * Get tasks by state
   */
  async getTasksByState(state: GNAPTask['state']): Promise<GNAPTask[]> {
    return this.filterTasks({ state });
  }

  /**
   * Get tasks by priority
   */
  async getTasksByPriority(priority: number): Promise<GNAPTask[]> {
    return this.filterTasks({ priority });
  }

  /**
   * Count tasks by state
   */
  async countTasksByState(): Promise<Record<GNAPTask['state'], number>> {
    const tasks = await this.listTasks();

    const counts: Record<string, number> = {
      backlog: 0,
      ready: 0,
      in_progress: 0,
      review: 0,
      done: 0,
      blocked: 0,
      cancelled: 0
    };

    for (const task of tasks) {
      counts[task.state]++;
    }

    return counts as Record<GNAPTask['state'], number>;
  }

  /**
   * Search tasks
   */
  async searchTasks(query: string): Promise<GNAPTask[]> {
    const tasks = await this.listTasks();
    const lowerQuery = query.toLowerCase();

    return tasks.filter(task =>
      task.title.toLowerCase().includes(lowerQuery) ||
      task.desc?.toLowerCase().includes(lowerQuery) ||
      task.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get task modification time
   */
  async getTaskModTime(id: string): Promise<number | null> {
    try {
      const filePath = join(this.repoPath, '.gnap', 'tasks', `${id}.json`);
      const stats = statSync(filePath);
      return stats.mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * Batch create tasks
   */
  async batchCreateTasks(tasks: GNAPTask[]): Promise<void> {
    for (const task of tasks) {
      await this.createTask(task);
    }
    logger.info({ count: tasks.length }, 'Batch tasks created');
  }

  /**
   * Batch update tasks
   */
  async batchUpdateTasks(tasks: GNAPTask[]): Promise<void> {
    for (const task of tasks) {
      await this.updateTask(task);
    }
    logger.info({ count: tasks.length }, 'Batch tasks updated');
  }

  /**
   * Batch delete tasks
   */
  async batchDeleteTasks(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.deleteTask(id);
    }
    logger.info({ count: ids.length }, 'Batch tasks deleted');
  }
}
