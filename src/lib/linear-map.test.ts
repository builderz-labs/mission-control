import { describe, it, expect } from 'vitest'
import {
  statusToLinearStateType,
  linearStateTypeToStatus,
  priorityToLinear,
  linearToPriority,
} from '@/lib/linear-map'

describe('Linear Mapping', () => {
  describe('statusToLinearStateType', () => {
    it('maps inbox to backlog', () => {
      expect(statusToLinearStateType('inbox')).toBe('backlog')
    })
    it('maps assigned to unstarted', () => {
      expect(statusToLinearStateType('assigned')).toBe('unstarted')
    })
    it('maps in_progress to started', () => {
      expect(statusToLinearStateType('in_progress')).toBe('started')
    })
    it('maps done to completed', () => {
      expect(statusToLinearStateType('done')).toBe('completed')
    })
  })

  describe('linearStateTypeToStatus', () => {
    it('maps backlog to inbox', () => {
      expect(linearStateTypeToStatus('backlog')).toBe('inbox')
    })
    it('maps unstarted to assigned', () => {
      expect(linearStateTypeToStatus('unstarted')).toBe('assigned')
    })
    it('maps started to in_progress', () => {
      expect(linearStateTypeToStatus('started')).toBe('in_progress')
    })
    it('maps completed to done', () => {
      expect(linearStateTypeToStatus('completed')).toBe('done')
    })
  })

  describe('priorityToLinear', () => {
    it('maps critical to 1', () => {
      expect(priorityToLinear('critical')).toBe(1)
    })
    it('maps high to 2', () => {
      expect(priorityToLinear('high')).toBe(2)
    })
    it('maps medium to 3', () => {
      expect(priorityToLinear('medium')).toBe(3)
    })
    it('maps low to 4', () => {
      expect(priorityToLinear('low')).toBe(4)
    })
  })

  describe('linearToPriority', () => {
    it('maps 1 to critical', () => {
      expect(linearToPriority(1)).toBe('critical')
    })
    it('maps 2 to high', () => {
      expect(linearToPriority(2)).toBe('high')
    })
    it('maps 3 to medium', () => {
      expect(linearToPriority(3)).toBe('medium')
    })
    it('maps 4 to low', () => {
      expect(linearToPriority(4)).toBe('low')
    })
  })
})
