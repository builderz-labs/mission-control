'use client'

import {
  CalendarView,
  JobList,
  JobDetailsPane,
  CreateJobModal,
  useCronData,
} from './cron-management'

export function CronManagementPanel() {
  const state = useCronData()

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cron Management</h1>
            <p className="text-muted-foreground mt-2">
              Manage automated tasks and scheduled jobs
            </p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={state.loadCronJobs}
              disabled={state.isLoading}
              className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              {state.isLoading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              onClick={() => state.setShowAddForm(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
            >
              Add Job
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <CalendarView
          isLocalMode={state.isLocalMode}
          calendarView={state.calendarView}
          calendarRangeLabel={state.calendarRangeLabel}
          calendarOccurrences={state.calendarOccurrences}
          dayJobs={state.dayJobs}
          jobsByWeekDay={state.jobsByWeekDay}
          jobsByMonthDay={state.jobsByMonthDay}
          selectedDayJobs={state.selectedDayJobs}
          selectedCalendarDate={state.selectedCalendarDate}
          calendarDate={state.calendarDate}
          searchQuery={state.searchQuery}
          agentFilter={state.agentFilter}
          stateFilter={state.stateFilter}
          uniqueAgents={state.uniqueAgents}
          onJobSelect={state.handleJobSelect}
          onMoveCalendar={state.moveCalendar}
          onSetCalendarDate={state.setCalendarDate}
          onSetSelectedCalendarDate={state.setSelectedCalendarDate}
          onSetCalendarView={state.setCalendarView}
          onSearchChange={state.setSearchQuery}
          onAgentFilterChange={state.setAgentFilter}
          onStateFilterChange={state.setStateFilter}
        />

        <JobList
          cronJobs={state.cronJobs}
          isLoading={state.isLoading}
          selectedJob={state.selectedJob}
          onJobSelect={state.handleJobSelect}
          onToggleJob={state.toggleJob}
          onTriggerJob={state.triggerJob}
          onRemoveJob={state.removeJob}
        />

        <JobDetailsPane
          selectedJob={state.selectedJob}
          jobLogs={state.jobLogs}
        />
      </div>

      <CreateJobModal
        show={state.showAddForm}
        newJob={state.newJob}
        availableModels={state.availableModels}
        onNewJobChange={state.setNewJob}
        onAddJob={state.addJob}
        onClose={() => state.setShowAddForm(false)}
      />
    </div>
  )
}
