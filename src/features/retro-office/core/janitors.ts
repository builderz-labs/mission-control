import {
  JANITOR_ENTRY_POINTS,
  JANITOR_EXIT_POINTS,
  ROAM_POINTS,
} from "@/features/retro-office/core/navigation";
import type { JanitorActor } from "@/features/retro-office/core/types";
import type { OfficeCleaningCue } from "@/features/retro-office/adapters";

export const JANITOR_SWEEP_DURATION_MS = 60_000;
const JANITOR_COUNT = 3;
const JANITOR_COLOR = "#4b5563";
const JANITOR_TOOLS = ["broom", "vacuum", "floor_scrubber"] as const;

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const buildJanitorActorsForCue = (
  cue: OfficeCleaningCue,
  cleaningStops: { x: number; y: number; facing: number }[],
): JanitorActor[] => {
  const availableStops =
    cleaningStops.length > 0
      ? cleaningStops
      : ROAM_POINTS.map((point, index) => ({
          ...point,
          facing: index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
        }));
  const seed = hashString(cue.id);
  const desiredStopCount = Math.min(Math.max(availableStops.length, 4), 6);
  return Array.from({ length: JANITOR_COUNT }, (_, index) => {
    const entry = JANITOR_ENTRY_POINTS[index % JANITOR_ENTRY_POINTS.length];
    const exit = JANITOR_EXIT_POINTS[index % JANITOR_EXIT_POINTS.length];
    const stopOffset = (seed + index * 2) % availableStops.length;
    const routeStops = Array.from({ length: desiredStopCount }, (_, stopIndex) => {
      return availableStops[(stopOffset + stopIndex) % availableStops.length]!;
    });
    return {
      id: `janitor:${cue.id}:${index}`,
      name: "",
      role: "janitor",
      status: "working",
      color: JANITOR_COLOR,
      item: "cleaning",
      janitorTool: JANITOR_TOOLS[index % JANITOR_TOOLS.length] ?? "broom",
      janitorRoute: [entry, ...routeStops, exit],
      janitorPauseMs: 3_500 + index * 700,
      janitorDespawnAt: cue.ts + JANITOR_SWEEP_DURATION_MS,
    };
  });
};

export const pruneExpiredJanitorActors = (
  actors: JanitorActor[],
  now: number,
): JanitorActor[] => actors.filter((actor) => actor.janitorDespawnAt > now);
