/**
 * Lionroot panel router for Mission Control's ContentRouter.
 *
 * This file is imported by the patched page.tsx (see UPSTREAM-PATCHES.md).
 * Add new panel routes here — no other upstream file needs to change.
 *
 * Returns a React element for known Lionroot tabs, or null for upstream tabs.
 */

"use client";

import type { ReactNode } from "react";

// Phase 2: Guidance
// import { GuidancePanel } from "./GuidancePanel";

// Phase 3: Loops
// import { LoopsPanel } from "./LoopsPanel";

// Phase 4: Observatory + Nightshift
// import { ObservatoryPanel } from "./ObservatoryPanel";
// import { NightshiftPanel } from "./NightshiftPanel";

// Phase 5: Calendar + Usage
// import { CalendarPanel } from "./CalendarPanel";
import { UsageLedgerPanel } from "./usage-ledger-panel";

const PLACEHOLDER = (name: string) => (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <div className="text-center">
      <p className="text-lg font-semibold">{name}</p>
      <p className="text-sm">Coming soon — porting from Command Post</p>
    </div>
  </div>
);

export function LionrootContentRouter(activeTab: string): ReactNode | null {
  switch (activeTab) {
    case "guidance":
      return PLACEHOLDER("Guidance — Commander's Intent");
    case "loops":
      return PLACEHOLDER("Loops — Zulip Stream Monitor");
    case "observatory":
      return PLACEHOLDER("Observatory — Session Graph");
    case "nightshift":
      return PLACEHOLDER("Nightshift — Activity Monitor");
    case "lr-calendar":
      return PLACEHOLDER("Calendar Sync");
    case "usage-ledger":
      return <UsageLedgerPanel />;
    default:
      return null;
  }
}
