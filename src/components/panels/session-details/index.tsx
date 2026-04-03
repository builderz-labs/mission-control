'use client'

import type { JSX } from 'react'
import { useSessionDetails } from './use-session-details'
import { SessionFilters } from './session-filters'
import { SessionCard } from './session-card'
import { SessionSidebar } from './session-sidebar'

export function SessionDetailsPanel(): JSX.Element {
  const state = useSessionDetails()

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Session Management</h1>
        <p className="text-muted-foreground mt-2">Monitor and manage active agent sessions</p>
      </div>

      <SessionFilters
        sessionFilter={state.sessionFilter}
        onSessionFilterChange={state.setSessionFilter}
        sortBy={state.sortBy}
        onSortByChange={state.setSortBy}
        timeWindow={state.timeWindow}
        onTimeWindowChange={state.setTimeWindow}
        includeGlobal={state.includeGlobal}
        onIncludeGlobalChange={state.setIncludeGlobal}
        includeUnknown={state.includeUnknown}
        onIncludeUnknownChange={state.setIncludeUnknown}
        filteredCount={state.filteredSessions.length}
        totalCount={state.sessions.length}
        activeCount={state.sessions.filter((s) => s.active).length}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {state.sortedSessions.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-12 text-center">
              <div className="text-muted-foreground">No sessions match the current filter</div>
            </div>
          ) : (
            state.sortedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={state.selectedSession === session.id}
                isExpanded={state.expandedSession === session.id}
                controllingSession={state.controllingSession}
                editingLabel={state.editingLabel}
                labelValue={state.labelValue}
                confirmingDelete={state.confirmingDelete}
                labelInputRef={state.labelInputRef}
                modelInfo={state.getModelInfo(session.model)}
                tokenUsage={state.parseTokenUsage(session.tokens)}
                status={state.getSessionStatus(session)}
                statusColor={state.getStatusColor(state.getSessionStatus(session))}
                typeIcon={state.getSessionTypeIcon(session.key)}
                sessionType={state.getSessionType(session.key)}
                onSelect={() => state.handleSessionSelect(session)}
                onSendAction={state.sendSessionAction}
                onSetControlling={state.setControllingSession}
                onEditLabel={state.setEditingLabel}
                onSetLabelValue={state.setLabelValue}
                onLabelSave={state.handleLabelSave}
                onSetConfirmingDelete={state.setConfirmingDelete}
                onDeleteSession={state.handleDeleteSession}
              />
            ))
          )}
        </div>

        <SessionSidebar
          sessions={state.sessions}
          parseTokenUsage={state.parseTokenUsage}
          getModelInfo={state.getModelInfo}
        />
      </div>
    </div>
  )
}
