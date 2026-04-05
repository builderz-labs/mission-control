// @ts-nocheck — Wrapper for Claw3D RetroOffice3D; type fixes in progress
"use client";

import { Suspense, useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader } from "@/components/ui/loader";
import { useMissionControl } from "@/store";
import { agentToOfficeAgent } from "@/features/retro-office/adapters";

const RetroOffice3D = dynamic(
  () =>
    import("@/features/retro-office/RetroOffice3D").then(
      (mod) => mod.RetroOffice3D
    ),
  { ssr: false, loading: () => <Office3DLoading /> }
);

function Office3DLoading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[560px] bg-background">
      <div className="text-center space-y-3">
        <Loader className="mx-auto" />
        <p className="text-sm text-muted-foreground">Loading 3D Office...</p>
      </div>
    </div>
  );
}

export function Office3DPanel() {
  const agents = useMissionControl((s) => s.agents);

  const officeAgents = useMemo(
    () => agents.map(agentToOfficeAgent),
    [agents]
  );

  return (
    <div className="h-full w-full">
      <Suspense fallback={<Office3DLoading />}>
        <RetroOffice3D
          agents={officeAgents}
          officeTitle="Mission Control"
          officeTitleLoaded
        />
      </Suspense>
    </div>
  );
}
