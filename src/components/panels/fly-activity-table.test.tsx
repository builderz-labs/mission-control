import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { FlyActivityTable } from './fly-activity-table'
it('provides a bounded accessible empty-state table rather than invented jobs',()=>{
  render(<FlyActivityTable activity={{submissions:0,active_workers:0,queued:0,estimated_compute_usd:0,oldest_queue_seconds:0,states:{},jobs:[]}} />)
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(screen.getByText('No worker attempts recorded.')).toBeInTheDocument()
})
