import {
  DOOR_LENGTH,
  DOOR_THICKNESS,
  EAST_WING_DOOR_Y,
  EAST_WING_ROOM_HEIGHT,
  EAST_WING_ROOM_TOP_Y,
  GYM_ROOM_END_X,
  GYM_ROOM_X,
  QA_LAB_END_X,
  QA_LAB_X,
  WALL_THICKNESS,
} from "@/features/retro-office/core/constants";
import { nextUid } from "@/features/retro-office/core/geometry";
import {
  hasAtmMigrationApplied,
  hasGymRoomMigrationApplied,
  hasPhoneBoothMigrationApplied,
  hasQaLabMigrationApplied,
  hasSmsBoothMigrationApplied,
  hasServerRoomMigrationApplied,
} from "@/features/retro-office/core/persistence";
import type {
  FurnitureItem,
  FurnitureSeed,
} from "@/features/retro-office/core/types";

const DEFAULT_PINGPONG_TABLE: FurnitureSeed = {
  type: "pingpong",
  x: 950,
  y: 600,
  w: 100,
  h: 60,
};

const DEFAULT_ATM_MACHINE: FurnitureSeed = {
  type: "atm",
  x: 430,
  y: 210,
  facing: 90,
};

const DEFAULT_PHONE_BOOTH: FurnitureSeed = {
  type: "phone_booth",
  x: 1050,
  y: 190,
  facing: 270,
};

const DEFAULT_SMS_BOOTH: FurnitureSeed = {
  type: "sms_booth",
  x: 700,
  y: 10,
  facing: 0,
};

const DEFAULT_JUKEBOX: FurnitureSeed = {
  type: "jukebox",
  x: 20,
  y: 380,
  facing: 90,
};

const DEFAULT_KANBAN_BOARD: FurnitureSeed = {
  type: "kanban_board",
  x: 460,
  y: -60,
  facing: 180,
};

const PREVIOUS_SERVER_ROOM_ITEMS_BOTTOM_RIGHT: FurnitureSeed[] = [
  { type: "wall", x: 820, y: 540, w: 280, h: WALL_THICKNESS },
  { type: "wall", x: 820, y: 540, w: WALL_THICKNESS, h: 70 },
  { type: "wall", x: 820, y: 650, w: WALL_THICKNESS, h: 70 },
  {
    type: "door",
    x: 820,
    y: 610,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  { type: "server_rack", x: 885, y: 575, facing: 180 },
  { type: "server_rack", x: 955, y: 575, facing: 180 },
  { type: "server_terminal", x: 930, y: 640, facing: 0 },
];

const PREVIOUS_SERVER_ROOM_ITEMS_TOP_RIGHT: FurnitureSeed[] = [
  { type: "wall", x: 820, y: 0, w: WALL_THICKNESS, h: 130 },
  { type: "wall", x: 820, y: 170, w: WALL_THICKNESS, h: 60 },
  {
    type: "door",
    x: 820,
    y: 130,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  { type: "wall", x: 820, y: 230, w: 280, h: WALL_THICKNESS },
  { type: "server_rack", x: 875, y: 95, facing: 180 },
  { type: "server_rack", x: 950, y: 95, facing: 180 },
  { type: "server_terminal", x: 930, y: 185, facing: 0 },
];

const DEFAULT_DINING_ITEMS: FurnitureSeed[] = [
  { type: "round_table", x: 890, y: 100, r: 50 },
  { type: "chair", x: 930, y: 100, facing: 0 },
  { type: "chair", x: 930, y: 180, facing: 180 },
  { type: "chair", x: 880, y: 130, facing: 90 },
  { type: "chair", x: 970, y: 130, facing: 270 },
];

const DEFAULT_SERVER_ROOM_ITEMS: FurnitureSeed[] = [
  { type: "wall", x: 0, y: 560, w: 230, h: WALL_THICKNESS },
  { type: "wall", x: 220, y: 560, w: WALL_THICKNESS, h: 60 },
  {
    type: "door",
    x: 210,
    y: 630,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  { type: "wall", x: 220, y: 660, w: WALL_THICKNESS, h: 60 },
  { type: "server_rack", x: 50, y: 595, facing: 0 },
  { type: "server_rack", x: 125, y: 595, facing: 0 },
  { type: "server_terminal", x: 110, y: 645, facing: 180 },
];

const LEGACY_GYM_ROOM_ITEMS: FurnitureSeed[] = [
  { type: "wall", x: 1092, y: 0, w: WALL_THICKNESS, h: 260 },
  {
    type: "door",
    x: 1092,
    y: 260,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  { type: "wall", x: 1092, y: 300, w: WALL_THICKNESS, h: 420 },
  { type: "wall", x: 1092, y: 0, w: 358, h: WALL_THICKNESS },
  { type: "wall", x: 1092, y: 712, w: 358, h: WALL_THICKNESS },
  { type: "wall", x: 1442, y: 0, w: WALL_THICKNESS, h: 260 },
  {
    type: "door",
    x: 1442,
    y: 260,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  { type: "wall", x: 1442, y: 300, w: WALL_THICKNESS, h: 420 },
  { type: "treadmill", x: 1160, y: 90, facing: 90 },
  { type: "treadmill", x: 1160, y: 210, facing: 90 },
  { type: "rowing_machine", x: 1150, y: 340, facing: 90 },
  { type: "weight_bench", x: 1240, y: 120, facing: 90 },
  { type: "weight_bench", x: 1240, y: 260, facing: 90 },
  { type: "dumbbell_rack", x: 1320, y: 90, facing: 180 },
  { type: "dumbbell_rack", x: 1320, y: 220, facing: 180 },
  { type: "kettlebell_rack", x: 1310, y: 330, facing: 180 },
  { type: "exercise_bike", x: 1180, y: 410, facing: 90 },
  { type: "exercise_bike", x: 1180, y: 540, facing: 90 },
  { type: "punching_bag", x: 1360, y: 390, facing: 0 },
  { type: "punching_bag", x: 1360, y: 560, facing: 0 },
  { type: "yoga_mat", x: 1240, y: 470, facing: 0, color: "#0f766e" },
  { type: "yoga_mat", x: 1240, y: 560, facing: 0, color: "#7c3aed" },
  { type: "plant", x: 1400, y: 40 },
  { type: "plant", x: 1400, y: 660 },
];

const LEGACY_QA_LAB_ITEMS: FurnitureSeed[] = [
  { type: "wall", x: 1442, y: 0, w: 358, h: WALL_THICKNESS },
  { type: "wall", x: 1442, y: 712, w: 358, h: WALL_THICKNESS },
  { type: "wall", x: 1792, y: 0, w: WALL_THICKNESS, h: 720 },
  { type: "qa_terminal", x: 1530, y: 95, facing: 90 },
  { type: "device_rack", x: 1650, y: 90, facing: 180 },
  { type: "device_rack", x: 1650, y: 220, facing: 180 },
  { type: "test_bench", x: 1520, y: 320, facing: 90 },
  { type: "test_bench", x: 1520, y: 470, facing: 90 },
  { type: "plant", x: 1750, y: 40 },
  { type: "plant", x: 1750, y: 660 },
];

const EAST_WING_ROOM_BOTTOM_Y = EAST_WING_ROOM_TOP_Y + EAST_WING_ROOM_HEIGHT;
const EAST_WING_ROOM_BOTTOM_WALL_Y = EAST_WING_ROOM_BOTTOM_Y - WALL_THICKNESS;
const EAST_WING_DOOR_BOTTOM_Y = EAST_WING_DOOR_Y + DOOR_LENGTH;
const EAST_WING_TOP_WALL_HEIGHT = EAST_WING_DOOR_Y - EAST_WING_ROOM_TOP_Y;
const EAST_WING_BOTTOM_WALL_HEIGHT =
  EAST_WING_ROOM_BOTTOM_Y - EAST_WING_DOOR_BOTTOM_Y;

const PREVIOUS_GYM_ROOM_ITEMS: FurnitureSeed[] = [
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_ROOM_HEIGHT,
  },
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: GYM_ROOM_END_X - GYM_ROOM_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_BOTTOM_WALL_Y,
    w: GYM_ROOM_END_X - GYM_ROOM_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: GYM_ROOM_END_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_TOP_WALL_HEIGHT,
  },
  {
    type: "door",
    x: GYM_ROOM_END_X,
    y: EAST_WING_DOOR_Y,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  {
    type: "wall",
    x: GYM_ROOM_END_X,
    y: EAST_WING_DOOR_BOTTOM_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_BOTTOM_WALL_HEIGHT,
  },
  { type: "treadmill", x: 1188, y: 88, facing: 90 },
  { type: "weight_bench", x: 1250, y: 92, facing: 90 },
  { type: "dumbbell_rack", x: 1272, y: 160, facing: 180 },
  { type: "rowing_machine", x: 1186, y: 248, facing: 90 },
  { type: "kettlebell_rack", x: 1278, y: 268, facing: 180 },
  { type: "exercise_bike", x: 1192, y: 370, facing: 90 },
  { type: "punching_bag", x: 1310, y: 394, facing: 0 },
  { type: "yoga_mat", x: 1218, y: 544, facing: 0, color: "#0f766e" },
  { type: "plant", x: 1312, y: 82 },
  { type: "plant", x: 1312, y: 622 },
];

const PREVIOUS_QA_LAB_ITEMS: FurnitureSeed[] = [
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_TOP_WALL_HEIGHT,
  },
  {
    type: "door",
    x: QA_LAB_X,
    y: EAST_WING_DOOR_Y,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_DOOR_BOTTOM_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_BOTTOM_WALL_HEIGHT,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: QA_LAB_END_X - QA_LAB_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_BOTTOM_WALL_Y,
    w: QA_LAB_END_X - QA_LAB_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: QA_LAB_END_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_ROOM_HEIGHT,
  },
  { type: "qa_terminal", x: 1496, y: 92, facing: 90 },
  { type: "device_rack", x: 1568, y: 88, facing: 180 },
  { type: "device_rack", x: 1568, y: 194, facing: 180 },
  { type: "test_bench", x: 1492, y: 300, facing: 90 },
  { type: "test_bench", x: 1492, y: 434, facing: 90 },
  { type: "plant", x: 1604, y: 82 },
  { type: "plant", x: 1604, y: 622 },
];

const DEFAULT_GYM_ITEMS: FurnitureSeed[] = [
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_ROOM_HEIGHT,
  },
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: GYM_ROOM_END_X - GYM_ROOM_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: GYM_ROOM_X,
    y: EAST_WING_ROOM_BOTTOM_WALL_Y,
    w: GYM_ROOM_END_X - GYM_ROOM_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: GYM_ROOM_END_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: 220,
  },
  {
    type: "door",
    x: 1280,
    y: 280,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  {
    type: "wall",
    x: GYM_ROOM_END_X,
    y: 300,
    w: WALL_THICKNESS,
    h: 380,
  },
  { type: "treadmill", x: 1142, y: 90, facing: 90 },
  { type: "weight_bench", x: 1204, y: 92, facing: 90 },
  { type: "dumbbell_rack", x: 1220, y: 160, facing: 180 },
  { type: "rowing_machine", x: 1140, y: 222, facing: 90 },
  { type: "kettlebell_rack", x: 1224, y: 248, facing: 180 },
  { type: "exercise_bike", x: 1146, y: 366, facing: 90 },
  { type: "punching_bag", x: 1266, y: 380, facing: 0 },
  { type: "yoga_mat", x: 1168, y: 542, facing: 0, color: "#0f766e" },
  { type: "plant", x: 1268, y: 82 },
  { type: "plant", x: 1268, y: 622 },
];

const DEFAULT_QA_LAB_ITEMS: FurnitureSeed[] = [
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: 220,
  },
  {
    type: "door",
    x: 1340,
    y: 280,
    w: DOOR_LENGTH,
    h: DOOR_THICKNESS,
    facing: 90,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: 300,
    w: WALL_THICKNESS,
    h: 380,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: QA_LAB_END_X - QA_LAB_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: QA_LAB_X,
    y: EAST_WING_ROOM_BOTTOM_WALL_Y,
    w: QA_LAB_END_X - QA_LAB_X + WALL_THICKNESS,
    h: WALL_THICKNESS,
  },
  {
    type: "wall",
    x: QA_LAB_END_X,
    y: EAST_WING_ROOM_TOP_Y,
    w: WALL_THICKNESS,
    h: EAST_WING_ROOM_HEIGHT,
  },
  { type: "qa_terminal", x: 1374, y: 92, facing: 90 },
  { type: "device_rack", x: 1454, y: 92, facing: 180 },
  { type: "device_rack", x: 1454, y: 204, facing: 180 },
  { type: "test_bench", x: 1372, y: 316, facing: 90 },
  { type: "test_bench", x: 1372, y: 450, facing: 90 },
  { type: "plant", x: 1496, y: 82 },
  { type: "plant", x: 1496, y: 622 },
];

const DEFAULT_ART_ROOM_ITEMS: FurnitureSeed[] = [
  { type: "wall", x: 260, y: 40, w: 8, h: 230 },
  { type: "wall", x: 260, y: 40, w: 178, h: 8 },
  { type: "wall", x: 260, y: 262, w: 178, h: 8 },
  { type: "wall", x: 430, y: 40, w: 8, h: 90 },
  { type: "door", x: 420, y: 150, w: 40, h: 8, facing: 90 },
  { type: "wall", x: 430, y: 170, w: 8, h: 100 },
  { type: "easel", x: 278, y: 84, facing: 90 },
  { type: "easel", x: 278, y: 158, facing: 90 },
  { type: "plant", x: 280, y: 60 },
  { type: "plant", x: 280, y: 240 },
];

const DEFAULT_FURNITURE: FurnitureSeed[] = [
  { type: "round_table", x: 50, y: 50, r: 90 },
  { type: "chair", x: 130, y: 50, facing: 0 },
  { type: "chair", x: 200, y: 90, facing: 325 },
  { type: "chair", x: 180, y: 170, facing: 240 },
  { type: "chair", x: 120, y: 480, facing: 180 },
  { type: "chair", x: 50, y: 150, facing: 105 },
  { type: "chair", x: 60, y: 80, facing: 60 },
  { type: "chair", x: 550, y: 50, facing: 0 },
  { type: "bookshelf", x: 600, y: 30, w: 80, h: 120 },
  { type: "couch", x: 270, y: 90, w: 40, h: 80, vertical: true, facing: 180 },
  { type: "fridge", x: 1050, y: 20, w: 40, h: 80 },
  { type: "stove", x: 920, y: 20 },
  { type: "cabinet", x: 980, y: 30, w: 40, h: 40 },
  { type: "microwave", x: 1030, y: 10, facing: 0 },
  { type: "sink", x: 970, y: 20 },
  { type: "dishwasher", x: 950, y: 20, w: 40, h: 40 },
  { type: "cabinet", x: 840, y: 30, w: 80, h: 40, elevation: 0 },
  { type: "coffee_machine", x: 880, y: 30, elevation: 0.56 },
  { type: "wall_cabinet", x: 960, y: 10, w: 80, h: 20, elevation: 0.9 },
  { type: "wall_cabinet", x: 880, y: 10, w: 80, h: 20, elevation: 0.9 },
  { type: "round_table", x: 890, y: 100, r: 50 },
  { type: "chair", x: 930, y: 100, facing: 0 },
  { type: "chair", x: 930, y: 180, facing: 180 },
  { type: "chair", x: 880, y: 130, facing: 90 },
  { type: "chair", x: 970, y: 130, facing: 270 },
  { type: "vending", x: 790, y: 10 },
  { type: "trash", x: 210, y: 20 },
  { type: "desk_cubicle", x: 100, y: 300, id: "desk_0" },
  { type: "chair", x: 120, y: 290, facing: 180 },
  { type: "computer", x: 120, y: 287 },
  { type: "keyboard", x: 130, y: 295 },
  { type: "mouse", x: 152, y: 295 },
  { type: "trash", x: 170, y: 290 },
  { type: "desk_cubicle", x: 300, y: 300, id: "desk_1" },
  { type: "chair", x: 320, y: 290, facing: 180 },
  { type: "computer", x: 320, y: 287 },
  { type: "keyboard", x: 330, y: 295 },
  { type: "mouse", x: 352, y: 295 },
  { type: "trash", x: 370, y: 290 },
  { type: "desk_cubicle", x: 500, y: 300, id: "desk_2" },
  { type: "chair", x: 520, y: 290, facing: 180 },
  { type: "computer", x: 520, y: 287 },
  { type: "keyboard", x: 530, y: 295 },
  { type: "mouse", x: 552, y: 295 },
  { type: "trash", x: 570, y: 290 },
  { type: "desk_cubicle", x: 700, y: 300, id: "desk_3" },
  { type: "chair", x: 720, y: 290, facing: 180 },
  { type: "computer", x: 720, y: 287 },
  { type: "keyboard", x: 730, y: 295 },
  { type: "mouse", x: 752, y: 295 },
  { type: "trash", x: 770, y: 290 },
  { type: "desk_cubicle", x: 100, y: 500, id: "desk_4" },
  { type: "computer", x: 120, y: 487 },
  { type: "keyboard", x: 130, y: 490 },
  { type: "mouse", x: 152, y: 495 },
  { type: "trash", x: 170, y: 490 },
  { type: "desk_cubicle", x: 300, y: 500, id: "desk_5" },
  { type: "chair", x: 310, y: 490, facing: 180 },
  { type: "computer", x: 320, y: 487 },
  { type: "keyboard", x: 330, y: 495 },
  { type: "mouse", x: 352, y: 495 },
  { type: "trash", x: 370, y: 500 },
  { type: "desk_cubicle", x: 500, y: 500, id: "desk_6" },
  { type: "chair", x: 520, y: 490, facing: 180 },
  { type: "computer", x: 520, y: 487 },
  { type: "keyboard", x: 530, y: 495 },
  { type: "mouse", x: 552, y: 495 },
  { type: "trash", x: 570, y: 490 },
  { type: "desk_cubicle", x: 700, y: 500, id: "desk_7" },
  { type: "chair", x: 720, y: 490, facing: 180 },
  { type: "computer", x: 720, y: 487 },
  { type: "keyboard", x: 730, y: 495 },
  { type: "mouse", x: 752, y: 495 },
  { type: "trash", x: 770, y: 490 },
  { type: "couch", x: 1000, y: 380, w: 100, h: 40, facing: 90 },
  { type: "couch", x: 390, y: 630, w: 100, h: 40 },
  { type: "table_rect", x: 980, y: 380, w: 60, h: 30, facing: 270 },
  { type: "pingpong", x: 950, y: 600, w: 100, h: 60 },
  { type: "beanbag", x: 1000, y: 330, color: "#e65100", facing: 90 },
  { type: "beanbag", x: 1000, y: 410, color: "#1565c0", facing: 90 },
  DEFAULT_ATM_MACHINE,
  DEFAULT_PHONE_BOOTH,
  DEFAULT_KANBAN_BOARD,
  { type: "whiteboard", x: 40, y: 200, w: 10, h: 60 },
  { type: "clock", x: 550, y: 5 },
  { type: "lamp", x: 430, y: 100 },
  { type: "lamp", x: 980, y: 390 },
  { type: "trash", x: 830, y: 20 },
  { type: "plant", x: 40, y: 40 },
  { type: "plant", x: 660, y: 30 },
  { type: "plant", x: 340, y: 700 },
  { type: "plant", x: 450, y: 450 },
  { type: "plant", x: 1090, y: 310 },
  { type: "plant", x: 1100, y: 490 },
  { type: "plant", x: 530, y: 700 },
  ...DEFAULT_SERVER_ROOM_ITEMS,
  ...DEFAULT_GYM_ITEMS,
  ...DEFAULT_QA_LAB_ITEMS,
  ...DEFAULT_ART_ROOM_ITEMS,
  DEFAULT_SMS_BOOTH,
  { type: "chair", x: 100, y: 200, facing: 180 },
];

export const materializeDefaults = (): FurnitureItem[] =>
  DEFAULT_FURNITURE.map((item, index) => ({
    ...item,
    _uid: `default_${index}`,
  }));

export const isRetiredPingPongLamp = (item: FurnitureItem) =>
  item.type === "lamp" &&
  ((item.x === 870 && item.y === 470) || (item.x === 900 && item.y === 580));

const createFurnitureSignature = (item: FurnitureSeed | FurnitureItem) =>
  [
    item.type,
    item.x,
    item.y,
    item.w ?? "",
    item.h ?? "",
    item.r ?? "",
    item.facing ?? "",
    item.vertical ? 1 : 0,
    item.elevation ?? "",
  ].join(":");

const PREVIOUS_SERVER_ROOM_SIGNATURES = new Set(
  [
    ...PREVIOUS_SERVER_ROOM_ITEMS_BOTTOM_RIGHT,
    ...PREVIOUS_SERVER_ROOM_ITEMS_TOP_RIGHT,
  ].map(createFurnitureSignature),
);

const SERVER_ROOM_SIGNATURES = new Set(
  DEFAULT_SERVER_ROOM_ITEMS.map(createFurnitureSignature),
);

const LEGACY_GYM_ROOM_SIGNATURES = new Set(
  LEGACY_GYM_ROOM_ITEMS.map(createFurnitureSignature),
);
const PREVIOUS_GYM_ROOM_SIGNATURES = new Set(
  PREVIOUS_GYM_ROOM_ITEMS.map(createFurnitureSignature),
);
const GYM_ROOM_SIGNATURES = new Set(
  DEFAULT_GYM_ITEMS.map(createFurnitureSignature),
);
const LEGACY_QA_LAB_SIGNATURES = new Set(
  LEGACY_QA_LAB_ITEMS.map(createFurnitureSignature),
);
const PREVIOUS_QA_LAB_SIGNATURES = new Set(
  PREVIOUS_QA_LAB_ITEMS.map(createFurnitureSignature),
);
const QA_LAB_SIGNATURES = new Set(
  DEFAULT_QA_LAB_ITEMS.map(createFurnitureSignature),
);

const hasSignature = (items: FurnitureItem[], signatures: Set<string>) =>
  items.some((item) => signatures.has(createFurnitureSignature(item)));

const hasAllSignatures = (items: FurnitureItem[], signatures: Set<string>) => {
  const itemSignatures = new Set(items.map(createFurnitureSignature));
  return [...signatures].every((signature) => itemSignatures.has(signature));
};

const replaceBySignatureSet = (
  items: FurnitureItem[],
  signatures: Set<string>,
) => items.filter((item) => !signatures.has(createFurnitureSignature(item)));

export const ensureOfficePingPongTable = (
  items: FurnitureItem[],
): FurnitureItem[] => {
  if (items.some((item) => item.type === "pingpong")) return items;
  return [...items, { ...DEFAULT_PINGPONG_TABLE, _uid: nextUid() }];
};

export const ensureOfficeAtm = (items: FurnitureItem[]): FurnitureItem[] => {
  if (items.some((item) => item.type === "atm")) return items;
  if (hasAtmMigrationApplied()) return items;
  return [...items, { ...DEFAULT_ATM_MACHINE, _uid: nextUid() }];
};

export const ensureOfficeJukebox = (items: FurnitureItem[]): FurnitureItem[] => {
  if (items.some((item) => item.type === "jukebox")) return items;
  return [...items, { ...DEFAULT_JUKEBOX, _uid: nextUid() }];
};

export const ensureOfficeKanbanBoard = (items: FurnitureItem[]): FurnitureItem[] => {
  if (items.some((item) => item.type === "kanban_board")) return items;
  return [...items, { ...DEFAULT_KANBAN_BOARD, _uid: nextUid() }];
};

export const ensureOfficePhoneBooth = (
  items: FurnitureItem[],
): FurnitureItem[] => {
  let found = false;
  const nextItems = items.map((item) => {
    if (item.type === "phone_booth") {
      found = true;
      if (item.x === 980 && item.y === 560) {
        return { ...item, x: 1050, y: 190 };
      }
    }
    return item;
  });

  if (found) return nextItems;
  if (hasPhoneBoothMigrationApplied()) return nextItems;
  return [...nextItems, { ...DEFAULT_PHONE_BOOTH, _uid: nextUid() }];
};

export const ensureOfficeSmsBooth = (
  items: FurnitureItem[],
): FurnitureItem[] => {
  if (items.some((item) => item.type === "sms_booth")) return items;
  if (hasSmsBoothMigrationApplied()) return items;
  return [...items, { ...DEFAULT_SMS_BOOTH, _uid: nextUid() }];
};

export const ensureOfficeServerRoom = (
  items: FurnitureItem[],
): FurnitureItem[] => {
  const hasCurrentServerRoom = items.some((item) =>
    SERVER_ROOM_SIGNATURES.has(createFurnitureSignature(item)),
  );
  if (hasCurrentServerRoom) return items;

  const hasPreviousServerRoom = items.some((item) =>
    PREVIOUS_SERVER_ROOM_SIGNATURES.has(createFurnitureSignature(item)),
  );

  if (hasPreviousServerRoom) {
    const withoutPreviousServerRoom = items.filter(
      (item) =>
        !PREVIOUS_SERVER_ROOM_SIGNATURES.has(createFurnitureSignature(item)) &&
        item.type !== "server_rack" &&
        item.type !== "server_terminal",
    );
    const nextItems = [...withoutPreviousServerRoom];
    for (const diningItem of DEFAULT_DINING_ITEMS) {
      const hasDiningItem = nextItems.some(
        (item) =>
          createFurnitureSignature(item) ===
          createFurnitureSignature(diningItem),
      );
      if (!hasDiningItem) {
        nextItems.push({ ...diningItem, _uid: nextUid() });
      }
    }
    return [
      ...nextItems,
      ...DEFAULT_SERVER_ROOM_ITEMS.map((item) => ({
        ...item,
        _uid: nextUid(),
      })),
    ];
  }

  if (items.some((item) => item.type === "server_terminal")) return items;
  if (hasServerRoomMigrationApplied()) return items;
  return [
    ...items,
    ...DEFAULT_SERVER_ROOM_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
  ];
};

export const ensureOfficeGymRoom = (
  items: FurnitureItem[],
): FurnitureItem[] => {
  const hasCurrentGymRoom = hasSignature(items, GYM_ROOM_SIGNATURES);
  if (hasCurrentGymRoom) return items;

  const hasPreviousGymRoom = hasAllSignatures(
    items,
    PREVIOUS_GYM_ROOM_SIGNATURES,
  );
  if (hasPreviousGymRoom) {
    return [
      ...replaceBySignatureSet(items, PREVIOUS_GYM_ROOM_SIGNATURES),
      ...DEFAULT_GYM_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
    ];
  }

  const hasLegacyGymRoom = hasAllSignatures(items, LEGACY_GYM_ROOM_SIGNATURES);
  if (hasLegacyGymRoom) {
    return [
      ...replaceBySignatureSet(items, LEGACY_GYM_ROOM_SIGNATURES),
      ...DEFAULT_GYM_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
    ];
  }

  const hasGymEquipment = items.some((item) =>
    [
      "treadmill",
      "weight_bench",
      "dumbbell_rack",
      "exercise_bike",
      "punching_bag",
      "rowing_machine",
      "kettlebell_rack",
      "yoga_mat",
    ].includes(item.type),
  );
  if (hasGymEquipment) return items;
  if (hasGymRoomMigrationApplied()) return items;
  return [
    ...items,
    ...DEFAULT_GYM_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
  ];
};

export const ensureOfficeQaLab = (items: FurnitureItem[]): FurnitureItem[] => {
  const hasCurrentQaLab = hasSignature(items, QA_LAB_SIGNATURES);
  if (hasCurrentQaLab) return items;

  const hasPreviousQaLab = hasAllSignatures(items, PREVIOUS_QA_LAB_SIGNATURES);
  if (hasPreviousQaLab) {
    return [
      ...replaceBySignatureSet(items, PREVIOUS_QA_LAB_SIGNATURES),
      ...DEFAULT_QA_LAB_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
    ];
  }

  const hasLegacyQaLab = hasAllSignatures(items, LEGACY_QA_LAB_SIGNATURES);
  if (hasLegacyQaLab) {
    return [
      ...replaceBySignatureSet(items, LEGACY_QA_LAB_SIGNATURES),
      ...DEFAULT_QA_LAB_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
    ];
  }

  const hasQaFurniture = items.some((item) =>
    ["qa_terminal", "device_rack", "test_bench"].includes(item.type),
  );
  if (hasQaFurniture) return items;
  if (hasQaLabMigrationApplied()) return items;

  return [
    ...items,
    ...DEFAULT_QA_LAB_ITEMS.map((item) => ({ ...item, _uid: nextUid() })),
  ];
};
