import type { StateCreator } from 'zustand'
import type { Task, Comment } from '../types'

export interface TaskSlice {
  tasks: Task[]
  selectedTask: Task | null
  setTasks: (tasks: Task[]) => void
  setSelectedTask: (task: Task | null) => void
  addTask: (task: Task) => void
  updateTask: (taskId: number, updates: Partial<Task>) => void
  deleteTask: (taskId: number) => void
  taskComments: Record<number, Comment[]>
  setTaskComments: (taskId: number, comments: Comment[]) => void
  addTaskComment: (taskId: number, comment: Comment) => void
}

export const createTaskSlice: StateCreator<TaskSlice, [], [], TaskSlice> = (set) => ({
  tasks: [],
  selectedTask: null,
  setTasks: (tasks) => set({ tasks }),
  setSelectedTask: (task) => set({ selectedTask: task }),
  addTask: (task) =>
    set((state) => ({
      tasks: [task, ...state.tasks]
    })),
  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      ),
      selectedTask: state.selectedTask?.id === taskId
        ? { ...state.selectedTask, ...updates }
        : state.selectedTask
    })),
  deleteTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask
    })),
  taskComments: {},
  setTaskComments: (taskId, comments) =>
    set((state) => ({
      taskComments: { ...state.taskComments, [taskId]: comments }
    })),
  addTaskComment: (taskId, comment) =>
    set((state) => ({
      taskComments: {
        ...state.taskComments,
        [taskId]: [comment, ...(state.taskComments[taskId] || [])]
      }
    })),
})
