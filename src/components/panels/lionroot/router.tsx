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
import { BriefingRoomPanel } from "./BriefingRoomPanel";
import { GuidancePanel } from "./GuidancePanel";

import { UsageLedgerPanel } from "./usage-ledger-panel";

export function LionrootContentRouter(activeTab: string): ReactNode | null {
  switch (activeTab) {
    case "briefing-room":
      return <BriefingRoomPanel />;
    case "guidance":
      return <GuidancePanel />;
    case "usage-ledger":
      return <UsageLedgerPanel />;
    default:
      return null;
  }
}
