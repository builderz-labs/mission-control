import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMissionControl } from '@/store'

describe('Store slice isolation', () => {
  beforeEach(() => {
    useMissionControl.setState({
      agents: [],
      tasks: [],
      selectedAgent: null,
      selectedTask: null,
    })
  })

  it('agent state change does not trigger task selector callback', () => {
    const taskCallback = vi.fn()
    const unsub = useMissionControl.subscribe(
      (state) => state.tasks,
      taskCallback
    )

    // Change agent state
    useMissionControl.getState().setAgents([{
      id: 1,
      name: 'test-agent',
      role: 'worker',
      status: 'idle',
      created_at: Date.now(),
      updated_at: Date.now(),
    }])

    // Task callback should NOT fire — tasks didn't change
    expect(taskCallback).not.toHaveBeenCalled()
    unsub()
  })

  it('task state change does not trigger agent selector callback', () => {
    const agentCallback = vi.fn()
    const unsub = useMissionControl.subscribe(
      (state) => state.agents,
      agentCallback
    )

    // Change task state
    useMissionControl.getState().setTasks([{
      id: 1,
      title: 'test-task',
      status: 'inbox',
      priority: 'medium',
      created_by: 'admin',
      created_at: Date.now(),
      updated_at: Date.now(),
    }])

    // Agent callback should NOT fire — agents didn't change
    expect(agentCallback).not.toHaveBeenCalled()
    unsub()
  })

  it('notification state change does not trigger chat selector callback', () => {
    const chatCallback = vi.fn()
    const unsub = useMissionControl.subscribe(
      (state) => state.chatMessages,
      chatCallback
    )

    useMissionControl.getState().addNotification({
      id: 1,
      recipient: 'admin',
      type: 'info',
      title: 'Test',
      message: 'test notification',
      created_at: Date.now(),
    })

    expect(chatCallback).not.toHaveBeenCalled()
    unsub()
  })

  it('all domain slices are accessible from composed store', () => {
    const state = useMissionControl.getState()
    // Session slice
    expect(state).toHaveProperty('sessions')
    expect(state).toHaveProperty('setSessions')
    // Agent slice
    expect(state).toHaveProperty('agents')
    expect(state).toHaveProperty('setAgents')
    // Task slice
    expect(state).toHaveProperty('tasks')
    expect(state).toHaveProperty('setTasks')
    // Chat slice
    expect(state).toHaveProperty('chatMessages')
    expect(state).toHaveProperty('setChatMessages')
    // Notification slice
    expect(state).toHaveProperty('notifications')
    expect(state).toHaveProperty('setNotifications')
    // UI slice
    expect(state).toHaveProperty('activeTab')
    expect(state).toHaveProperty('setActiveTab')
  })

  it('subscribeWithSelector is enabled on composed store', () => {
    // Verify subscribe accepts selector + listener (subscribeWithSelector API)
    const unsub = useMissionControl.subscribe(
      (state) => state.activeTab,
      () => {}
    )
    expect(typeof unsub).toBe('function')
    unsub()
  })
})
