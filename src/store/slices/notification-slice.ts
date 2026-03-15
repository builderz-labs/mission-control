import type { StateCreator } from 'zustand'
import type { Notification, Activity } from '../types'

export interface NotificationSlice {
  notifications: Notification[]
  unreadNotificationCount: number
  setNotifications: (notifications: Notification[]) => void
  addNotification: (notification: Notification) => void
  markNotificationRead: (notificationId: number) => void
  markAllNotificationsRead: () => void
  activities: Activity[]
  setActivities: (activities: Activity[]) => void
  addActivity: (activity: Activity) => void
}

export const createNotificationSlice: StateCreator<NotificationSlice, [], [], NotificationSlice> = (set) => ({
  notifications: [],
  unreadNotificationCount: 0,
  setNotifications: (notifications) =>
    set({
      notifications,
      unreadNotificationCount: notifications.filter(n => !n.read_at).length
    }),
  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 500),
      unreadNotificationCount: state.unreadNotificationCount + 1
    })),
  markNotificationRead: (notificationId) =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read_at: Math.floor(Date.now() / 1000) }
          : notification
      ),
      unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1)
    })),
  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.read_at ? notification : { ...notification, read_at: Math.floor(Date.now() / 1000) }
      ),
      unreadNotificationCount: 0
    })),
  activities: [],
  setActivities: (activities) => set({ activities }),
  addActivity: (activity) =>
    set((state) => ({
      activities: [activity, ...state.activities].slice(0, 1000)
    })),
})
