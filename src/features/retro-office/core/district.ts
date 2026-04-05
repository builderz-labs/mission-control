import { SNAP_GRID } from "@/features/retro-office/core/constants";
import { snap } from "@/features/retro-office/core/geometry";
import type { FurnitureItem } from "@/features/retro-office/core/types";

export type DistrictZone = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export const LOCAL_OFFICE_CANVAS_WIDTH = 1800;
export const LOCAL_OFFICE_CANVAS_HEIGHT = 720;

export const LOCAL_OFFICE_ZONE: DistrictZone = {
  minX: 0,
  maxX: LOCAL_OFFICE_CANVAS_WIDTH,
  minY: 0,
  maxY: LOCAL_OFFICE_CANVAS_HEIGHT,
};

export const CITY_PATH_ZONE: DistrictZone = {
  minX: 0,
  maxX: LOCAL_OFFICE_CANVAS_WIDTH,
  minY: 760,
  maxY: 980,
};

export const REMOTE_OFFICE_ZONE: DistrictZone = {
  minX: 0,
  maxX: LOCAL_OFFICE_CANVAS_WIDTH,
  minY: 1020,
  maxY: 1020 + LOCAL_OFFICE_CANVAS_HEIGHT,
};

export const REMOTE_ROAM_POINTS = [
  { x: 800, y: 1220 },
  { x: 850, y: 1520 },
  { x: 820, y: 1600 },
  { x: 450, y: 1440 },
  { x: 250, y: 1440 },
  { x: 650, y: 1440 },
  { x: 150, y: 1640 },
] as const;

export const DISTRICT_CAMERA_POSITION: [number, number, number] = [14, 16, 18];
export const DISTRICT_CAMERA_TARGET: [number, number, number] = [0, 0, 1];
export const DISTRICT_CAMERA_ZOOM = 34;

export const isRemoteOfficeAgentId = (agentId: string) => agentId.startsWith("remote:");

const clampZoneValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, snap(value)));

export const clampPointToZone = (
  x: number,
  y: number,
  zone: DistrictZone,
): { x: number; y: number } => ({
  x: clampZoneValue(x, zone.minX + SNAP_GRID, zone.maxX - SNAP_GRID),
  y: clampZoneValue(y, zone.minY + SNAP_GRID, zone.maxY - SNAP_GRID),
});

export const pickRandomPointInZone = (
  zone: DistrictZone,
  random = Math.random,
): { x: number; y: number } =>
  clampPointToZone(
    zone.minX + (zone.maxX - zone.minX) * random(),
    zone.minY + (zone.maxY - zone.minY) * random(),
    zone,
  );

export const projectFurnitureIntoRemoteOfficeZone = (params: {
  furniture: FurnitureItem[];
  sourceWidth: number;
  sourceHeight: number;
}): FurnitureItem[] => {
  const sourceWidth = Math.max(1, params.sourceWidth);
  const sourceHeight = Math.max(1, params.sourceHeight);
  const targetWidth = REMOTE_OFFICE_ZONE.maxX - REMOTE_OFFICE_ZONE.minX;
  const targetHeight = REMOTE_OFFICE_ZONE.maxY - REMOTE_OFFICE_ZONE.minY;
  const canCloneExactly =
    sourceWidth === LOCAL_OFFICE_CANVAS_WIDTH && sourceHeight === LOCAL_OFFICE_CANVAS_HEIGHT;

  if (canCloneExactly) {
    const offsetX = REMOTE_OFFICE_ZONE.minX - LOCAL_OFFICE_ZONE.minX;
    const offsetY = REMOTE_OFFICE_ZONE.minY - LOCAL_OFFICE_ZONE.minY;
    return params.furniture.map((item) => ({
      ...item,
      _uid: `remote-layout:${item._uid}`,
      x: offsetX + item.x,
      y: offsetY + item.y,
    }));
  }

  const padding = 30;
  const usableTargetWidth = Math.max(1, targetWidth - padding * 2);
  const usableTargetHeight = Math.max(1, targetHeight - padding * 2);
  const scale = Math.min(usableTargetWidth / sourceWidth, usableTargetHeight / sourceHeight);
  const contentWidth = sourceWidth * scale;
  const contentHeight = sourceHeight * scale;
  const offsetX = REMOTE_OFFICE_ZONE.minX + (targetWidth - contentWidth) / 2;
  const offsetY = REMOTE_OFFICE_ZONE.minY + (targetHeight - contentHeight) / 2;
  return params.furniture.map((item) => {
    const scaledWidth = typeof item.w === "number" ? item.w * scale : undefined;
    const scaledHeight = typeof item.h === "number" ? item.h * scale : undefined;
    return {
      ...item,
      _uid: `remote-layout:${item._uid}`,
      x: offsetX + item.x * scale,
      y: offsetY + item.y * scale,
      ...(typeof scaledWidth === "number" ? { w: scaledWidth } : {}),
      ...(typeof scaledHeight === "number" ? { h: scaledHeight } : {}),
      ...(typeof item.r === "number" ? { r: item.r * scale } : {}),
    };
  });
};
