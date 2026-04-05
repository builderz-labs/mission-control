import { getItemBaseSize } from "@/features/retro-office/core/geometry";
import type {
  FurnitureItem,
  SmsBoothRoute,
} from "@/features/retro-office/core/types";

export const SMS_BOOTH_DEFAULT_TARGET = {
  x: 1078,
  y: 518,
  facing: Math.PI / 2,
};

export const resolveSmsBoothRoute = (
  item: FurnitureItem | null | undefined,
  x: number,
  y: number,
): SmsBoothRoute => {
  if (!item) {
    return {
      stage: "typing",
      targetX: SMS_BOOTH_DEFAULT_TARGET.x,
      targetY: SMS_BOOTH_DEFAULT_TARGET.y,
      facing: SMS_BOOTH_DEFAULT_TARGET.facing,
    };
  }
  const { width, height } = getItemBaseSize(item);
  const centerY = item.y + height / 2;
  const outerTarget = {
    x: item.x - 22,
    y: centerY,
    facing: Math.PI / 2,
  };
  const innerTarget = {
    x: item.x + width * 0.28,
    y: centerY,
    facing: Math.PI / 2,
  };
  const typingTarget = {
    x: item.x + width * 0.62,
    y: centerY,
    facing: Math.PI / 2,
  };

  const insideBooth =
    x >= innerTarget.x - 6 || Math.hypot(x - innerTarget.x, y - innerTarget.y) < 16;
  if (insideBooth) {
    return {
      stage: "typing",
      targetX: typingTarget.x,
      targetY: typingTarget.y,
      facing: typingTarget.facing,
    };
  }

  const withinDoorThreshold =
    x >= outerTarget.x - 8 || Math.hypot(x - outerTarget.x, y - outerTarget.y) < 16;
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
