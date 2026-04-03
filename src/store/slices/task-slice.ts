'use client'

import type { StateCreator } from 'zustand'
import type { JsonValue } from '../shared-types'

export interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  project_id?: number
  project_ticket_no?: number
  project_name?: string
  project_prefix?: string
  ticket_ref?: string
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  outcome?: 'success' | 'failed' | 'partial' | 'abandoned'
  error_message?: string
  resolution?: string
  feedback_rating?: number
  feedback_notes?: string
  retry_count?: number
  completed_at?: number
  tags?: string[]
  metadata?: JsonValue
  github_issue_number?: number
  github_repo?: string
  github_synced_at?: number
  github_branch?: string
  github_pr_number?: number
  github_pr_state?: string
}

export interface Activity {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data?: JsonValue
  created_at: number
  entity?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
}

export interface Notification {
  id: number
  recipient: string
  type: string
  title: string
  message: string
  source_type?: string
  source_id?: number
  read_at?: number
  delivered_at?: number
  created_at: number
  source?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
}

export interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
}

export interface StandupReport {
  date: string
  generatedAt: string
  summary: {
    totalAgents: number
    totalCompleted: number
    totalInProgress: number
    totalAssigned: number
    totalReview: number
    totalBlocked: number
    totalActivity: number
    overdue: number
  }
  agentReports: Array<{
    agent: {
      name: string
      role: string
      status: string
      last_seen?: number
      last_activity?: string
    }
    completedToday: Task[]
    inProgress: Task[]
    assigned: Task[]
    review: Task[]
    blocked: Task[]
    activity: {
      actionCount: number
      commentsCount: number
    }
  }>
  teamAccomplishments: Task[]
  teamBlockers: Task[]
  overdueTasks: Task[]
}

export interface ExecApprovalRequest {
  id: string
  sessionId: string
  agentName?: string
  toolName: string
  toolArgs: Record<string, unknown>
  command?: string
  cwd?: string
  host?: string
  resolvedPath?: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  expiresAt?: number
  status: 'pending' | 'approved' | 'denied' | 'expired'
}

export interface TaskSlice {
  tasks: Task[]
  selectedTask: Task | null
  setTasks: (tasks: Task[]) => void
  setSelectedTask: (task: Task | null) => void
  addTask: (task: Task) => void
  updateTask: (taskId: number, updates: Partial<Task>) => void
  deleteTask: (taskId: number) => void

  // Activities (task/agent event log)
  activities: Activity[]
  setActivities: (activities: Activity[]) => void
  addActivity: (activity: Activity) => void

  // Notifications
  notifications: Notification[]
  unreadNotificationCount: number
  setNotifications: (notifications: Notification[]) => void
  addNotification: (notification: Notification) => void
  markNotificationRead: (notificationId: number) => void
  markAllNotificationsRead: () => void

  // Comments per task
  taskComments: Record<number, Comment[]>
  setTaskComments: (taskId: number, comments: Comment[]) => void
  addTaskComment: (taskId: number, comment: Comment) => void

  // Standup reports
  standupReports: StandupReport[]
  currentStandupReport: StandupReport | null
  setStandupReports: (reports: StandupReport[]) => void
  setCurrentStandupReport: (report: StandupReport | null) => void

  // Exec approval queue (human-in-the-loop for risky commands)
  execApprovals: ExecApprovalRequest[]
  setExecApprovals: (approvals: ExecApprovalRequest[]) => void
  addExecApproval: (approval: ExecApprovalRequest) => void
  updateExecApproval: (id: string, updates: Partial<ExecApprovalRequest>) => void
}

// Task management slice — tasks, activities, notifications, comments, standup, exec approvals
export const createTaskSlice: StateCreator<TaskSlice, [], [], TaskSlice> = (set) => ({
  tasks: [],
  selectedTask: null,
  activities: [],
  notifications: [],
  unreadNotificationCount: 0,
  taskComments: {},
  standupReports: [],
  currentStandupReport: null,
  execApprovals: [],

  setTasks: (tasks) => set({ tasks }),

  setSelectedTask: (task) => set({ selectedTask: task }),

  addTask: (task) =>
    set((state) => ({ tasks: [task, ...state.tasks] })),

  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      ),
      selectedTask:
        state.selectedTask?.id === taskId
          ? { ...state.selectedTask, ...updates }
          : state.selectedTask,
    })),

  deleteTask: (taskId) =>
    set((state) => {
      // Clean up orphaned comments to prevent unbounded Record growth
      const { [taskId]: _removed, ...remainingComments } = state.taskComments
      return {
        tasks: state.tasks.filter((task) => task.id !== taskId),
        selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask,
        taskComments: remainingComments,
      }
    }),

  setActivities: (activities) => set({ activities }),

  addActivity: (activity) =>
    set((state) => ({
      // Cap at 1000 most recent activities
      activities: [activity, ...state.activities].slice(0, 1000),
    })),

  setNotifications: (notifications) =>
    set({
      notifications,
      unreadNotificationCount: notifications.filter((n) => !n.read_at).length,
    }),

  addNotification: (notification) =>
    set((state) => {
      const updated = [notification, ...state.notifications].slice(0, 500)
      // Derive count from actual state — never drift from manual increment/decrement
      return { notifications: updated, unreadNotificationCount: updated.filter((n) => !n.read_at).length }
    }),

  markNotificationRead: (notificationId) =>
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === notificationId ? { ...n, read_at: Math.floor(Date.now() / 1000) } : n
      )
      return { notifications: updated, unreadNotificationCount: updated.filter((n) => !n.read_at).length }
    }),

  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.read_at
          ? notification
          : { ...notification, read_at: Math.floor(Date.now() / 1000) }
      ),
      unreadNotificationCount: 0,
    })),

  setTaskComments: (taskId, comments) =>
    set((state) => ({
      taskComments: { ...state.taskComments, [taskId]: comments },
    })),

  addTaskComment: (taskId, comment) =>
    set((state) => ({
      taskComments: {
        ...state.taskComments,
        [taskId]: [comment, ...(state.taskComments[taskId] || [])],
      },
    })),

  setStandupReports: (reports) => set({ standupReports: reports }),

  setCurrentStandupReport: (report) => set({ currentStandupReport: report }),

  setExecApprovals: (approvals) => set({ execApprovals: approvals }),

  addExecApproval: (approval) =>
    set((state) => {
      // Deduplicate by id
      if (state.execApprovals.some((a) => a.id === approval.id)) return state
      return { execApprovals: [approval, ...state.execApprovals].slice(0, 200) }
    }),

  updateExecApproval: (id, updates) =>
    set((state) => ({
      execApprovals: state.execApprovals.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    })),
})
