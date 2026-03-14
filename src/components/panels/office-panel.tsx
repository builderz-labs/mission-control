'use client'

import {
  OfficeSidebar,
  OfficeFloorMap,
  OrgChartView,
  AgentDetailModal,
  FlightDeckModal,
  LaunchToastNotification,
} from './office'
import { useOfficeState } from './office/use-office-state'

export function OfficePanel() {
  const state = useOfficeState()

  if ((state.loading || (state.isLocalMode && state.localBootstrapping)) && state.visibleDisplayAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        <span className="ml-3 text-muted-foreground">
          {state.isLocalMode ? 'Scanning local sessions...' : 'Loading office...'}
        </span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Virtual Office</h1>
            <p className="text-muted-foreground mt-1">See your agents at work in real time</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground mr-4">
              {state.counts.busy > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />{state.counts.busy} working</span>}
              {state.counts.idle > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{state.counts.idle} idle</span>}
              {state.counts.error > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{state.counts.error} error</span>}
              {state.counts.offline > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" />{state.counts.offline} away</span>}
            </div>
            <div className="flex rounded-md overflow-hidden border border-border">
              <button
                onClick={() => state.setViewMode('office')}
                className={`px-3 py-1 text-sm transition-smooth ${state.viewMode === 'office' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
              >
                Office
              </button>
              <button
                onClick={() => state.setViewMode('org-chart')}
                className={`px-3 py-1 text-sm transition-smooth ${state.viewMode === 'org-chart' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
              >
                Org Chart
              </button>
            </div>
            <button onClick={state.fetchAgents} className="px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {state.visibleDisplayAgents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-5xl mb-3">🏢</div>
          <p className="text-lg">The office is empty</p>
          <p className="text-sm mt-1">Add agents to see them appear here</p>
        </div>
      ) : state.viewMode === 'office' ? (
        <div className={`grid grid-cols-1 ${state.showSidebar ? 'xl:grid-cols-[220px_1fr]' : 'xl:grid-cols-1'} gap-4`}>
          {state.showSidebar && (
            <OfficeSidebar
              visibleDisplayAgents={state.visibleDisplayAgents}
              sidebarFilter={state.sidebarFilter}
              setSidebarFilter={state.setSidebarFilter}
              isLocalMode={state.isLocalMode}
              localSessionFilter={state.localSessionFilter}
              setLocalSessionFilter={state.setLocalSessionFilter}
              filteredRosterRows={state.filteredRosterRows}
              renderedWorkers={state.renderedWorkers}
              setSelectedAgent={state.setSelectedAgent}
              focusMapPoint={state.focusMapPoint}
            />
          )}

          <OfficeFloorMap
            mapViewportRef={state.mapViewportRef}
            themePalette={state.themePalette}
            timeTheme={state.timeTheme}
            nightSparkles={state.nightSparkles}
            mapZoom={state.mapZoom}
            setMapZoom={state.setMapZoom}
            mapPan={state.mapPan}
            setMapPan={state.setMapPan}
            showSidebar={state.showSidebar}
            setShowSidebar={state.setShowSidebar}
            showMinimap={state.showMinimap}
            setShowMinimap={state.setShowMinimap}
            showEvents={state.showEvents}
            setShowEvents={state.setShowEvents}
            roomLayoutState={state.roomLayoutState}
            mapPropsState={state.mapPropsState}
            floorTiles={state.floorTiles}
            heatmapPoints={state.heatmapPoints}
            pathEdges={state.pathEdges}
            renderedWorkers={state.renderedWorkers}
            transitioningAgentIds={state.transitioningAgentIds}
            agentActionOverrides={state.agentActionOverrides}
            spriteFrame={state.spriteFrame}
            officeEvents={state.officeEvents}
            selectedHotspot={state.selectedHotspot}
            setSelectedHotspot={state.setSelectedHotspot}
            setSelectedAgent={state.setSelectedAgent}
            setTimeTheme={state.setTimeTheme}
            resetMapView={state.resetMapView}
            resetOfficeLayout={state.resetOfficeLayout}
            pushOfficeEvent={state.pushOfficeEvent}
            focusMapPoint={state.focusMapPoint}
            nudgeSelectedHotspot={state.nudgeSelectedHotspot}
            resizeSelectedRoom={state.resizeSelectedRoom}
            onMapWheel={state.onMapWheel}
            onMapMouseDown={state.onMapMouseDown}
            onMapMouseMove={state.onMapMouseMove}
            endMapDrag={state.endMapDrag}
          />
        </div>
      ) : (
        <OrgChartView
          orgSegmentMode={state.orgSegmentMode}
          setOrgSegmentMode={state.setOrgSegmentMode}
          orgGroups={state.orgGroups}
          setSelectedAgent={state.setSelectedAgent}
        />
      )}

      {state.selectedAgent && (
        <AgentDetailModal
          selectedAgent={state.selectedAgent}
          isLocalMode={state.isLocalMode}
          flightDeckLaunching={state.flightDeckLaunching}
          setSelectedAgent={state.setSelectedAgent}
          executeAgentAction={state.executeAgentAction}
          openFlightDeck={state.openFlightDeck}
        />
      )}

      <FlightDeckModal
        showFlightDeckModal={state.showFlightDeckModal}
        setShowFlightDeckModal={state.setShowFlightDeckModal}
        flightDeckDownloadUrl={state.flightDeckDownloadUrl}
      />

      {state.launchToast && <LaunchToastNotification launchToast={state.launchToast} />}

      <style jsx>{`
        @keyframes mcSunSweep {
          0% { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
          50% { transform: translateX(8%) translateY(2%); opacity: 0.56; }
          100% { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
        }
        @keyframes mcSunSweepReverse {
          0% { transform: translateX(8%) translateY(2%); opacity: 0.18; }
          50% { transform: translateX(-8%) translateY(-2%); opacity: 0.32; }
          100% { transform: translateX(8%) translateY(2%); opacity: 0.18; }
        }
        @keyframes mcDuskPulse {
          0% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 0.52; transform: scale(1.03); }
          100% { opacity: 0.28; transform: scale(1); }
        }
        @keyframes mcNightBloom {
          0% { opacity: 0.25; }
          50% { opacity: 0.5; }
          100% { opacity: 0.25; }
        }
        @keyframes mcTwinkle {
          0% { opacity: 0.25; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.15); }
          100% { opacity: 0.25; transform: scale(0.9); }
        }
      `}</style>
    </div>
  )
}
