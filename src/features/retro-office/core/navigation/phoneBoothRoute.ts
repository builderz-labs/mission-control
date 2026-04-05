import { getItemBaseSize } from "@/features/retro-office/core/geometry";
import type {
  FurnitureItem,
  PhoneBoothRoute,
} from "@/features/retro-office/core/types";

export const PHONE_BOOTH_DEFAULT_TARGET = {
  x: 1060,
  y: 436,
  facing: Math.PI / 2,
};

export const resolvePhoneBoothRoute = (
  item: FurnitureItem | null | undefined,
  x: number,
  y: number,
): PhoneBoothRoute => {
  if (!item) {
    return {
      stage: "receiver",
      targetX: PHONE_BOOTH_DEFAULT_TARGET.x,
      targetY: PHONE_BOOTH_DEFAULT_TARGET.y,
      facing: PHONE_BOOTH_DEFAULT_TARGET.facing,
    };
  }
  const { width, height } = getItemBaseSize(item);
  const centerY = item.y + height / 2;
  const outerTarget = {
    x: item.x - 28,
    y: centerY,
    facing: Math.PI / 2,
  };
  const innerTarget = {
    x: item.x + width * 0.3,
    y: centerY,
    facing: Math.PI / 2,
  };
  const receiverTarget = {
    x: item.x + width * 0.68,
    y: centerY,
    facing: Math.PI / 2,
  };

  const insideBooth =
    x >= innerTarget.x - 6 || Math.hypot(x - innerTarget.x, y - innerTarget.y) < 18;
  if (insideBooth) {
    return {
      stage: "receiver",
      targetX: receiverTarget.x,
      targetY: receiverTarget.y,
      facing: receiverTarget.facing,
    };
  }

  const withinDoorThreshold =
    x >= outerTarget.x - 8 || Math.hypot(x - outerTarget.x, y - outerTarget.y) < 18;
  if (withinDoorThreshold) {
    return {
      stage: "door_inner",
      targetX: innerTarget.x,
      targetY: innerTarget.y,
      facing: innerTarget.facing,
    };
  }

  return {
    stage: "door_outer",
    targetX: outerTarget.x,
    targetY: outerTarget.y,
    facing: outerTarget.facing,
  };
};
