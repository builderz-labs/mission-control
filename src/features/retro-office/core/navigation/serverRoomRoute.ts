import type { ServerRoomRoute } from "@/features/retro-office/core/types";

export const SERVER_ROOM_TARGET = {
  x: 110,
  y: 655,
  facing: 0,
};

const SERVER_ROOM_DOOR_OUTER_TARGET = {
  x: 268,
  y: 624,
  facing: 0,
};

const SERVER_ROOM_DOOR_INNER_TARGET = {
  x: 188,
  y: 624,
  facing: 0,
};

export const resolveServerRoomRoute = (
  x: number,
  y: number,
): ServerRoomRoute => {
  const insideRoom =
    x <= SERVER_ROOM_DOOR_INNER_TARGET.x + 8 ||
    Math.hypot(
      x - SERVER_ROOM_DOOR_INNER_TARGET.x,
      y - SERVER_ROOM_DOOR_INNER_TARGET.y,
    ) < 18;
  if (insideRoom) {
    return {
      stage: "terminal",
      targetX: SERVER_ROOM_TARGET.x,
      targetY: SERVER_ROOM_TARGET.y,
      facing: SERVER_ROOM_TARGET.facing,
    };
  }

  const withinDoorThreshold =
    x <= SERVER_ROOM_DOOR_OUTER_TARGET.x - 8 ||
    Math.hypot(
      x - SERVER_ROOM_DOOR_OUTER_TARGET.x,
      y - SERVER_ROOM_DOOR_OUTER_TARGET.y,
    ) < 18;
  if (withinDoorThreshold) {
    return {
      stage: "door_inner",
      targetX: SERVER_ROOM_DOOR_INNER_TARGET.x,
      targetY: SERVER_ROOM_DOOR_INNER_TARGET.y,
      facing: SERVER_ROOM_DOOR_INNER_TARGET.facing,
    };
  }

  return {
    stage: "door_outer",
    targetX: SERVER_ROOM_DOOR_OUTER_TARGET.x,
    targetY: SERVER_ROOM_DOOR_OUTER_TARGET.y,
    facing: SERVER_ROOM_DOOR_OUTER_TARGET.facing,
  };
};
