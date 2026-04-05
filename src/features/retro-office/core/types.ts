/**
 * Ported from Claw3D (MIT) — src/features/retro-office/core/types.ts
 * Adapted for Mission Control's agent data model.
 */

/* ── Avatar stub (mission-control does not ship Claw3D's avatar system) ── */
export type AgentAvatarProfile = {
  version: 1;
  seed: string;
  body: { skinTone: string };
  hair: { style: "short" | "parted" | "spiky" | "bun"; color: string };
  clothing: {
    topStyle: "tee" | "hoodie" | "jacket";
    topColor: string;
    bottomStyle: "pants" | "shorts" | "cuffed";
    bottomColor: string;
    shoesColor: string;
  };
  accessories: {
    glasses: boolean;
    headset: boolean;
    hatStyle: "none" | "cap" | "beanie";
    backpack: boolean;
  };
};

export function createDefaultAvatarProfile(seed: string): AgentAvatarProfile {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const h = (offset: number) => Math.abs((hash + offset * 127) % 360);
  const hsl = (offset: number, s = 60, l = 50) =>
    `hsl(${h(offset)}, ${s}%, ${l}%)`;
  return {
    version: 1,
    seed,
    body: { skinTone: hsl(0, 30, 65) },
    hair: { style: "short", color: hsl(1, 40, 35) },
    clothing: {
      topStyle: "tee",
      topColor: hsl(2),
      bottomStyle: "pants",
      bottomColor: hsl(3, 30, 40),
      shoesColor: hsl(4, 20, 30),
    },
    accessories: {
      glasses: hash % 3 === 0,
      headset: hash % 5 === 0,
      hatStyle: "none",
      backpack: false,
    },
  };
}

/* ── Interaction targets ── */
export const OFFICE_INTERACTION_TARGETS = [
  "desk",
  "server_room",
  "meeting_room",
  "gym",
  "jukebox",
  "qa_lab",
  "sms_booth",
  "phone_booth",
] as const;

export type OfficeInteractionTargetId =
  (typeof OFFICE_INTERACTION_TARGETS)[number];

/* ── Agent types ── */
export type OfficeAgent = {
  id: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  item: string;
  avatarProfile?: AgentAvatarProfile | null;
};

export type JanitorTool = "broom" | "vacuum" | "floor_scrubber";

export type JanitorActor = {
  id: string;
  name: string;
  role: "janitor";
  status: "working";
  color: string;
  item: "cleaning";
  janitorTool: JanitorTool;
  janitorRoute: FacingPoint[];
  janitorPauseMs: number;
  janitorDespawnAt: number;
};

export type SceneActor = OfficeAgent | JanitorActor;

export type RenderAgent = SceneActor & {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  facing: number;
  frame: number;
  walkSpeed: number;
  phaseOffset: number;
  state:
    | "walking"
    | "sitting"
    | "standing"
    | "away"
    | "working_out"
    | "dancing";
  awayUntil?: number;
  separationReplanAt?: number;
  bumpedUntil?: number;
  bumpTalkUntil?: number;
  collisionCooldownUntil?: number;
  pingPongUntil?: number;
  pingPongTargetX?: number;
  pingPongTargetY?: number;
  pingPongFacing?: number;
  pingPongPartnerId?: string;
  pingPongTableUid?: string;
  pingPongSide?: 0 | 1;
  pingPongPreviousWalkSpeed?: number;
  interactionTarget?: OfficeInteractionTargetId;
  smsBoothStage?: "door_outer" | "door_inner" | "typing";
  phoneBoothStage?: "door_outer" | "door_inner" | "receiver";
  serverRoomStage?: "door_outer" | "door_inner" | "terminal";
  gymStage?: "door_outer" | "door_inner" | "workout";
  qaLabStage?: "door_outer" | "door_inner" | "station";
  qaLabStationType?: QaLabStationType;
  workoutStyle?: "run" | "lift" | "bike" | "box" | "row" | "stretch";
  janitorRouteIndex?: number;
  janitorPauseUntil?: number;
};

/* ── Furniture types ── */
export type FurnitureItem = {
  _uid: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color?: string;
  id?: string;
  facing?: number;
  vertical?: boolean;
  elevation?: number;
};

export type FurnitureSeed = Omit<FurnitureItem, "_uid">;

/* ── Geometry types ── */
export type CanvasPoint = {
  x: number;
  y: number;
};

export type FacingPoint = CanvasPoint & {
  facing: number;
};

export type QaLabStationType = "console" | "device_rack" | "bench";

export type GymWorkoutLocation = FacingPoint & {
  workoutStyle: "run" | "lift" | "bike" | "box" | "row" | "stretch";
};

export type QaLabStationLocation = FacingPoint & {
  stationType: QaLabStationType;
};

export type ServerRoomRoute = {
  stage: "door_outer" | "door_inner" | "terminal";
  targetX: number;
  targetY: number;
  facing: number;
};

export type QaLabRoute = {
  stage: "door_outer" | "door_inner" | "station";
  targetX: number;
  targetY: number;
  facing: number;
};

export type GymRoute = {
  stage: "door_outer" | "door_inner" | "workout";
  targetX: number;
  targetY: number;
  facing: number;
};

export type PhoneBoothRoute = {
  stage: "door_outer" | "door_inner" | "receiver";
  targetX: number;
  targetY: number;
  facing: number;
};

export type SmsBoothRoute = {
  stage: "door_outer" | "door_inner" | "typing";
  targetX: number;
  targetY: number;
  facing: number;
};
