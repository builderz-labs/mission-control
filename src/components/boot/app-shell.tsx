'use client'

// The persistent chrome that wraps every authenticated page: navigation rail,
// header, system banners, main content area, live feed sidebar, and all global
// overlays (chat panel, exec approval, project manager, command bar).
//
// Kept separate from boot logic so that layout changes never risk touching the
// fragile boot-sequence state machine.

import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { ChatPanel } from '@/components/chat/chat-panel'
import { LocalModeBanner } from '@/components/layout/local-mode-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OpenClawUpdateBanner } from '@/components/layout/openclaw-update-banner'
import { OpenClawDoctorBanner } from '@/components/layout/openclaw-doctor-banner'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { ExecApprovalOverlay } from '@/components/modals/exec-approval-overlay'
import { CommandBar } from '@/components/command-bar/command-bar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ContentRouter } from '@/components/boot/panel-router'
import { DegradedModeToast } from '@/components/boot/boot-sequence'
import { useMissionControl } from '@/store'
import { useCommandBar } from '@/components/command-bar/use-command-bar'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AppShellProps {
  readonly activeTab: string
  readonly bootDegradedWarning: boolean
  readonly onDismissDegraded: () => void
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

export function AppShell({ activeTab, bootDegradedWarning, onDismissDegraded }: AppShellProps): React.ReactElement {
  const {
    showOnboarding,
    liveFeedOpen,
    toggleLiveFeed,
    showProjectManagerModal,
    setShowProjectManagerModal,
    fetchProjects,
  } = useMissionControl()

  const commandBar = useCommandBar()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Skip link for keyboard / screen-reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Left: icon rail navigation (hidden on mobile; bottom bar shown instead) */}
      {!showOnboarding && <NavRail />}

      {/* Center column: header + banners + scrollable content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!showOnboarding && (
          <>
            <HeaderBar />
            <LocalModeBanner />
            <UpdateBanner />
            <OpenClawUpdateBanner />
            <OpenClawDoctorBanner />
          </>
        )}
        <main
          id="main-content"
          className={`flex-1 overflow-auto pb-16 md:pb-0 ${showOnboarding ? 'pointer-events-none select-none blur-[2px] opacity-30' : ''}`}
          role="main"
          aria-hidden={showOnboarding}
        >
          <div aria-live="polite" className="flex flex-col min-h-full">
            <ErrorBoundary key={activeTab}>
              <ContentRouter tab={activeTab} />
            </ErrorBoundary>
          </div>
          <footer className="px-4 pb-4 pt-2">
            <p className="text-2xs text-muted-foreground/50 text-center">
              Built by{' '}
              <a
                href="https://www.linkedin.com/in/tonywalteur/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/70 hover:text-primary transition-colors duration-200"
              >
                Tony W.
              </a>{' '}
              for Mantu Group.
            </p>
          </footer>
        </main>
      </div>

      {/* Right: live feed panel (hidden on mobile) */}
      {!showOnboarding && liveFeedOpen && (
        <div className="hidden lg:flex h-full">
          <LiveFeed />
        </div>
      )}

      {/* Collapsed live-feed toggle button */}
      {!showOnboarding && !liveFeedOpen && (
        <button
          onClick={toggleLiveFeed}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 items-center justify-center bg-card border border-r-0 border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
          title="Show live feed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Global overlays — rendered outside the scrollable content area */}
      {!showOnboarding && <ChatPanel />}
      {!showOnboarding && <ExecApprovalOverlay />}
      {!showOnboarding && showProjectManagerModal && (
        <ProjectManagerModal
          onClose={() => setShowProjectManagerModal(false)}
          onChanged={async () => { await fetchProjects() }}
        />
      )}

      {/* Global ⌘K command bar */}
      <CommandBar isOpen={commandBar.isOpen} onClose={commandBar.close} />

      {/* Boot degraded-mode warning (fires when the 15 s failsafe triggered) */}
      {bootDegradedWarning && <DegradedModeToast onDismiss={onDismissDegraded} />}

      <OnboardingWizard />
    </div>
  )
}
