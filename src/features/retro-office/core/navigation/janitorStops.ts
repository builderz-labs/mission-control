import {
  CANVAS_H,
  CANVAS_W,
  SNAP_GRID,
} from "@/features/retro-office/core/constants";
import { snap } from "@/features/retro-office/core/geometry";
import type { FacingPoint, FurnitureItem } from "@/features/retro-office/core/types";

const JANITOR_STOP_TYPES = new Set([
  "trash",
  "vending",
  "water_cooler",
  "coffee_machine",
]);

const clampJanitorPoint = (x: number, y: number): { x: number; y: number } => ({
  x: Math.max(SNAP_GRID, Math.min(CANVAS_W - SNAP_GRID, snap(x))),
  y: Math.max(SNAP_GRID, Math.min(CANVAS_H - SNAP_GRID, snap(y))),
});

const resolveJanitorStop = (item: FurnitureItem): FacingPoint => {
  const offset =
    item.type === "trash"
      ? { dx: -35, dy: 10, facing: Math.PI / 2 }
      : item.type === "vending"
        ? { dx: -40, dy: 0, facing: Math.PI / 2 }
        : item.type === "water_cooler"
          ? { dx: -35, dy: 0, facing: Math.PI / 2 }
          : { dx: 0, dy: 35, facing: Math.PI };
  const point = clampJanitorPoint(item.x + offset.dx, item.y + offset.dy);
  return { ...point, facing: offset.facing };
};

export const getJanitorCleaningStops = (
  items: FurnitureItem[],
): FacingPoint[] => {
  const seen = new Set<string>();
  const stops: FacingPoint[] = [];
  for (const item of items) {
    if (!JANITOR_STOP_TYPES.has(item.type)) continue;
    const stop = resolveJanitorStop(item);
    const key = `${stop.x}:${stop.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push(stop);
  }
  return stops;
};
