'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { NavItemData } from './nav-item'

interface NavGroup {
  id: string
  label?: string
  items: NavItemData[]
}

interface MobileBottomBarProps {
  activeTab: string
  navigateToPanel: (tab: string) => void
  groups: NavGroup[]
  items: NavItemData[]
}

/** Mobile bottom tab bar with priority items and a "More" sheet */
export function MobileBottomBar({ activeTab, navigateToPanel, groups, items }: MobileBottomBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const priorityItems = items.filter(i => i.priority)
  const nonPriorityIds = new Set(items.filter(i => !i.priority).map(i => i.id))
  const moreIsActive = nonPriorityIds.has(activeTab)

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around px-1 h-14">
          {priorityItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => navigateToPanel(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg min-w-[48px] min-h-[48px] h-auto ${
                activeTab === item.id
                  ? 'text-primary hover:text-primary'
                  : ''
              }`}
            >
              <div className="w-5 h-5">{item.icon}</div>
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </Button>
          ))}
          {/* More button — opens the full navigation sheet */}
          <Button
            variant="ghost"
            onClick={() => setSheetOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg min-w-[48px] min-h-[48px] h-auto relative ${
              moreIsActive ? 'text-primary hover:text-primary' : ''
            }`}
          >
            <div className="w-5 h-5">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
            </div>
            <span className="text-[10px] font-medium">More</span>
            {moreIsActive && (
              <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </div>
      </nav>

      <MobileBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        activeTab={activeTab}
        navigateToPanel={navigateToPanel}
        groups={groups}
      />
    </>
  )
}

interface MobileBottomSheetProps {
  open: boolean
  onClose: () => void
  activeTab: string
  navigateToPanel: (tab: string) => void
  groups: NavGroup[]
}

/** Slide-up sheet showing all nav groups in a 2-column grid */
function MobileBottomSheet({ open, onClose, activeTab, navigateToPanel, groups }: MobileBottomSheetProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      // Mount first, then animate in on the next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open])

  // Close on Escape key for keyboard accessibility
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 200) // match transition duration
  }

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-[60]">
      {/* Backdrop — not focusable; Escape key closes via useEffect below */}
      <div
        role="presentation"
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      <div
        className={`absolute bottom-0 left-0 right-0 bg-card rounded-t-lg max-h-[70vh] overflow-y-auto safe-area-bottom transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="px-4 pb-6">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="my-3 border-t border-border" />}

              <div className="px-1 pt-1 pb-2">
                <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold">
                  {group.label || 'CORE'}
                </span>
              </div>

              {/* Flatten nested children for mobile — no expandable parents on small screens */}
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.flatMap(item => item.children ? item.children : [item]).map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => {
                      navigateToPanel(item.id)
                      handleClose()
                    }}
                    className={`flex items-center gap-2.5 px-3 min-h-[48px] h-auto rounded-lg justify-start ${
                      activeTab === item.id
                        ? 'bg-primary/15 text-primary hover:bg-primary/20'
                        : 'text-foreground'
                    }`}
                  >
                    <div className="w-5 h-5 shrink-0">{item.icon}</div>
                    <span className="text-xs font-medium truncate">{item.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
