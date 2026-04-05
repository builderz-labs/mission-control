"use client";

import { Fragment } from "react";
import { SCALE } from "@/features/retro-office/core/constants";
import {
  getItemBaseSize,
  getItemRotationRadians,
  toWorld,
} from "@/features/retro-office/core/geometry";
import type { FurnitureItem } from "@/features/retro-office/core/types";

const ITEM_COLOR_BY_TYPE: Record<string, string> = {
  wall: "#90a4ae",
  door: "#c0a080",
  desk_cubicle: "#8d6e63",
  chair: "#607d8b",
  round_table: "#a1887f",
  executive_desk: "#6d4c41",
  couch: "#7e57c2",
  couch_v: "#7e57c2",
  bookshelf: "#8d6e63",
  plant: "#66bb6a",
  beanbag: "#4db6ac",
  pingpong: "#90caf9",
  table_rect: "#8d6e63",
  coffee_machine: "#37474f",
  fridge: "#b0bec5",
  water_cooler: "#4fc3f7",
  atm: "#263238",
  sms_booth: "#26a69a",
  phone_booth: "#42a5f5",
  whiteboard: "#eceff1",
  cabinet: "#a1887f",
  computer: "#263238",
  lamp: "#fdd835",
  printer: "#b0bec5",
  stove: "#90a4ae",
  microwave: "#b0bec5",
  wall_cabinet: "#a1887f",
  sink: "#90a4ae",
  vending: "#ef5350",
  server_rack: "#37474f",
  server_terminal: "#455a64",
  qa_terminal: "#7e57c2",
  device_rack: "#546e7a",
  test_bench: "#8d6e63",
  treadmill: "#90a4ae",
  weight_bench: "#8d6e63",
  dumbbell_rack: "#546e7a",
  exercise_bike: "#90a4ae",
  punching_bag: "#ef5350",
  rowing_machine: "#90a4ae",
  kettlebell_rack: "#546e7a",
  yoga_mat: "#26a69a",
};

const ITEM_HEIGHT_BY_TYPE: Record<string, number> = {
  wall: 0.52,
  door: 0.08,
  plant: 0.18,
  computer: 0.07,
  lamp: 0.08,
  keyboard: 0.02,
  mouse: 0.02,
  mug: 0.025,
  clock: 0.02,
  wall_cabinet: 0.08,
};

export function RemoteOfficeLayoutPreview({
  items,
}: {
  items: FurnitureItem[];
}) {
  return (
    <group>
      {items.map((item) => {
        const { width, height } = getItemBaseSize(item);
        const centerX = item.x + width / 2;
        const centerY = item.y + height / 2;
        const [wx, , wz] = toWorld(centerX, centerY);
        const rotation = getItemRotationRadians(item);
        const boxHeight = ITEM_HEIGHT_BY_TYPE[item.type] ?? 0.12;
        const worldWidth = Math.max(width * SCALE, 0.03);
        const worldDepth = Math.max(height * SCALE, 0.03);
        const color = ITEM_COLOR_BY_TYPE[item.type] ?? "#78909c";
        return (
          <Fragment key={item._uid}>
            <mesh
              position={[wx, boxHeight / 2 + 0.004, wz]}
              rotation={[0, -rotation, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[worldWidth, boxHeight, worldDepth]} />
              <meshStandardMaterial color={color} roughness={0.82} metalness={0.08} />
            </mesh>
            {item.type === "door" ? (
              <mesh
                position={[wx, 0.01, wz]}
                rotation={[-Math.PI / 2, 0, 0]}
                receiveShadow
              >
                <planeGeometry args={[worldWidth, Math.max(worldDepth * 0.9, 0.02)]} />
                <meshBasicMaterial color="#fdd835" transparent opacity={0.55} />
              </mesh>
            ) : null}
          </Fragment>
        );
      })}
    </group>
  );
}
