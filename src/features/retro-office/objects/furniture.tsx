"use client";

import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SCALE } from "@/features/retro-office/core/constants";
import {
  FURNITURE_ROTATION,
  getItemBaseSize,
  getItemRotationRadians,
  resolveItemTypeKey,
  toWorld,
} from "@/features/retro-office/core/geometry";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import type { InteractiveFurnitureModelProps } from "@/features/retro-office/objects/types";

export const FURNITURE_GLB: Record<string, string> = {
  desk_cubicle: "/office-assets/models/furniture/desk.glb",
  executive_desk: "/office-assets/models/furniture/deskCorner.glb",
  chair: "/office-assets/models/furniture/chairDesk.glb",
  round_table: "/office-assets/models/furniture/tableRound.glb",
  couch: "/office-assets/models/furniture/loungeSofa.glb",
  couch_v: "/office-assets/models/furniture/loungeDesignChair.glb",
  bookshelf: "/office-assets/models/furniture/bookcaseClosed.glb",
  plant: "/office-assets/models/furniture/pottedPlant.glb",
  beanbag: "/office-assets/models/furniture/loungeDesignChair.glb",
  pingpong: "/office-assets/models/furniture/tableCoffee.glb",
  table_rect: "/office-assets/models/furniture/table.glb",
  coffee_machine: "/office-assets/models/furniture/kitchenCoffeeMachine.glb",
  fridge: "/office-assets/models/furniture/kitchenFridgeSmall.glb",
  water_cooler: "/office-assets/models/furniture/plantSmall1.glb",
  whiteboard: "/office-assets/models/furniture/bookcaseClosed.glb",
  kanban_board: "/office-assets/models/furniture/deskCorner.glb",
  cabinet: "/office-assets/models/furniture/kitchenCabinet.glb",
  computer: "/office-assets/models/furniture/computerScreen.glb",
  lamp: "/office-assets/models/furniture/lampRoundFloor.glb",
  printer: "/office-assets/models/furniture/kitchenCoffeeMachine.glb",
};

export const FURNITURE_SCALE: Record<string, [number, number, number]> = {
  desk_cubicle: [1.5, 1.5, 1.5],
  executive_desk: [1.8, 1.8, 1.8],
  chair: [1.2, 1.2, 1.2],
  round_table: [3.2, 3.2, 3.2],
  couch: [1.8, 1.8, 1.8],
  couch_v: [1.4, 1.4, 1.4],
  bookshelf: [1.5, 2, 1.5],
  plant: [1.2, 1.8, 1.2],
  beanbag: [1, 1, 1],
  pingpong: [2.4, 1.2, 1.6],
  table_rect: [1.4, 1.2, 1.0],
  coffee_machine: [0.8, 0.8, 0.8],
  fridge: [1, 1.4, 1],
  water_cooler: [1, 2, 1],
  whiteboard: [0.6, 1.4, 0.3],
  kanban_board: [1.8, 1.8, 1.8],
  cabinet: [2.6, 1.2, 1],
  computer: [1.1, 1.1, 1.1],
  lamp: [1.2, 1.2, 1.2],
  printer: [1, 1.2, 0.8],
};

export const FURNITURE_Y_OFFSET: Record<string, number> = {
  computer: 0.61,
};

/** Global offset for all kanban desk clutter (papers, monitor, mug, etc.). */
export const KANBAN_CLUTTER_OFFSET = { x: -1, y: 1, z: -2 };

export const FURNITURE_TINT: Record<string, string | null> = {
  desk_cubicle: "#8b5e32",
  executive_desk: "#6b3c1a",
  chair: "#4a5568",
  round_table: "#9a6332",
  couch: "#3d5575",
  couch_v: "#5a4870",
  bookshelf: "#5c3520",
  beanbag: null,
  computer: "#363c58",
  pingpong: "#2d6048",
  table_rect: "#7a5028",
  coffee_machine: "#2d2d38",
  fridge: "#505a60",
  water_cooler: "#3a5070",
  whiteboard: "#f4f2ee",
  kanban_board: "#8b5e32",
  cabinet: "#3c4248",
  plant: null,
  lamp: "#c8a060",
  printer: "#404858",
};

const SHADOW_CASTING_FURNITURE_TYPES = new Set([
  "desk_cubicle",
  "executive_desk",
  "round_table",
  "table_rect",
  "couch",
  "couch_v",
  "bookshelf",
  "cabinet",
  "fridge",
]);

const furnitureTemplateCache = new Map<string, THREE.Object3D>();

type InstancedFurnitureMeshDef = {
  castShadow: boolean;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrixWorld: THREE.Matrix4;
  receiveShadow: boolean;
};

const resolveFurnitureTemplate = (params: {
  glbPath: string;
  itemColor: string | undefined;
  itemType: string;
  scene: THREE.Object3D;
}) => {
  const cacheKey = `${params.glbPath}:${params.itemType}:${params.itemColor ?? ""}`;
  const cached = furnitureTemplateCache.get(cacheKey);
  if (cached) return cached;

  const rawTint =
    params.itemType === "beanbag"
      ? (params.itemColor ?? null)
      : FURNITURE_TINT[params.itemType];
  const tintColor = rawTint ? new THREE.Color(rawTint) : null;
  const template = params.scene.clone(true);
  const castShadow = SHADOW_CASTING_FURNITURE_TYPES.has(params.itemType);

  template.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const templateMats = mats.map((material) => {
      const nextMaterial = material.clone() as THREE.MeshStandardMaterial;
      if (tintColor && "color" in nextMaterial) {
        nextMaterial.color.lerp(tintColor, 0.8);
      }
      if ("roughness" in nextMaterial) nextMaterial.roughness = 0.65;
      if ("metalness" in nextMaterial) nextMaterial.metalness = 0.08;
      nextMaterial.userData = {
        ...nextMaterial.userData,
        furnitureSharedMaterial: true,
      };
      return nextMaterial;
    });
    mesh.material = Array.isArray(mesh.material)
      ? templateMats
      : templateMats[0];
  });

  furnitureTemplateCache.set(cacheKey, template);
  return template;
};

const buildFurnitureItemMatrix = (item: FurnitureItem, itemType: string) => {
  const [wx, , wz] = toWorld(item.x, item.y);
  const yOffset = (FURNITURE_Y_OFFSET[itemType] ?? 0) + (item.elevation ?? 0);
  const scale = FURNITURE_SCALE[itemType] ?? [1, 1, 1];
  const rotY = getItemRotationRadians(item);
  const { width, height } = getItemBaseSize(item);
  const pivotX = width * SCALE * 0.5;
  const pivotZ = height * SCALE * 0.5;

  const containerMatrix = new THREE.Matrix4().makeTranslation(wx, yOffset, wz);
  const pivotMatrix = new THREE.Matrix4().makeTranslation(pivotX, 0, pivotZ);
  const rotationMatrix = new THREE.Matrix4().makeRotationY(rotY);
  const unpivotMatrix = new THREE.Matrix4().makeTranslation(
    -pivotX,
    0,
    -pivotZ,
  );
  const scaleMatrix = new THREE.Matrix4().makeScale(
    scale[0],
    scale[1],
    scale[2],
  );

  return containerMatrix
    .multiply(pivotMatrix)
    .multiply(rotationMatrix)
    .multiply(unpivotMatrix)
    .multiply(scaleMatrix);
};

export function InstancedFurnitureItems({
  itemType,
  items,
  onItemClick,
}: {
  itemType: string;
  items: FurnitureItem[];
  onItemClick?: (itemUid: string) => void;
}) {
  const glbPath = FURNITURE_GLB[itemType] ?? FURNITURE_GLB.table_rect;
  const { scene } = useGLTF(glbPath);
  const template = useMemo(
    () =>
      resolveFurnitureTemplate({
        glbPath,
        itemColor: undefined,
        itemType,
        scene,
      }),
    [glbPath, itemType, scene],
  );
  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const meshDefs = useMemo<InstancedFurnitureMeshDef[]>(() => {
    template.updateMatrixWorld(true);
    const nextDefs: InstancedFurnitureMeshDef[] = [];
    template.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      nextDefs.push({
        castShadow: mesh.castShadow,
        geometry: mesh.geometry,
        material: mesh.material as THREE.Material,
        matrixWorld: mesh.matrixWorld.clone(),
        receiveShadow: mesh.receiveShadow,
      });
    });
    return nextDefs;
  }, [template]);
  const itemMatrices = useMemo(
    () => items.map((item) => buildFurnitureItemMatrix(item, itemType)),
    [itemType, items],
  );
  const itemUidByInstanceId = useMemo(
    () => items.map((item) => item._uid),
    [items],
  );

  const handleClick = useMemo(
    () =>
      onItemClick
        ? (event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            const instanceId = event.instanceId;
            if (typeof instanceId !== "number") return;
            const itemUid = itemUidByInstanceId[instanceId];
            if (!itemUid) return;
            onItemClick(itemUid);
          }
        : undefined,
    [itemUidByInstanceId, onItemClick],
  );

  useLayoutEffect(() => {
    meshDefs.forEach((def, meshIndex) => {
      const instancedMesh = meshRefs.current[meshIndex];
      if (!instancedMesh) return;
      const worldMatrix = new THREE.Matrix4();
      for (let itemIndex = 0; itemIndex < itemMatrices.length; itemIndex += 1) {
        worldMatrix.multiplyMatrices(itemMatrices[itemIndex], def.matrixWorld);
        instancedMesh.setMatrixAt(itemIndex, worldMatrix);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      instancedMesh.computeBoundingSphere();
    });
  }, [itemMatrices, meshDefs]);

  if (items.length === 0) return null;

  return (
    <>
      {meshDefs.map((def, meshIndex) => (
        <instancedMesh
          key={`${itemType}-${meshIndex}`}
          ref={(node) => {
            meshRefs.current[meshIndex] = node;
          }}
          args={[def.geometry, def.material, items.length]}
          castShadow={def.castShadow}
          receiveShadow={def.receiveShadow}
          onClick={handleClick}
        />
      ))}
    </>
  );
}

export function FurnitureModel({
  item,
  isSelected,
  isHovered,
  editMode,
  kanbanTaskCount = 0,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const itemType = resolveItemTypeKey(item);
  const glbPath = FURNITURE_GLB[itemType] ?? FURNITURE_GLB.table_rect;
  const { scene } = useGLTF(glbPath);
  const template = useMemo(
    () =>
      resolveFurnitureTemplate({
        glbPath,
        itemColor: item.color,
        itemType,
        scene,
      }),
    [glbPath, item.color, itemType, scene],
  );
  const cloned = useMemo(() => template.clone(true), [template]);
  const [wx, , wz] = toWorld(item.x, item.y);
  const yOffset = (FURNITURE_Y_OFFSET[itemType] ?? 0) + (item.elevation ?? 0);
  const scale = FURNITURE_SCALE[itemType] ?? [1, 1, 1];
  const rotY = getItemRotationRadians(item);
  const { width, height } = getItemBaseSize(item);
  const pivotX = width * SCALE * 0.5;
  const pivotZ = height * SCALE * 0.5;
  const kanbanDeskLoadout = useMemo(() => {
    const visibleTaskCount = Math.max(0, Math.min(kanbanTaskCount, 12));
    if (visibleTaskCount === 0) {
      return {
        papers: [] as Array<{
          x: number;
          y: number;
          z: number;
          w: number;
          h: number;
          r: number;
          color: string;
        }>,
        folders: [] as Array<{
          x: number;
          y: number;
          z: number;
          w: number;
          h: number;
          d: number;
          color: string;
          r: number;
        }>,
        stickyNotes: [] as Array<{
          x: number;
          y: number;
          z: number;
          color: string;
          r: number;
        }>,
        binders: [] as Array<{
          x: number;
          y: number;
          z: number;
          w: number;
          h: number;
          d: number;
          color: string;
          r: number;
        }>,
      };
    }

    const cx = KANBAN_CLUTTER_OFFSET.x;
    const cy = KANBAN_CLUTTER_OFFSET.y;
    const cz = KANBAN_CLUTTER_OFFSET.z;

    const papers = Array.from(
      { length: Math.min(visibleTaskCount + 2, 14) },
      (_, index) => {
        const row = index % 4;
        const stack = Math.floor(index / 4);
        return {
          x: cx + -0.22 + row * 0.16 + (stack % 2) * 0.03,
          z: cz + 0.06 - stack * 0.12 + (row % 2) * 0.02,
          y: cy + stack * 0.007 + index * 0.0015,
          w: 0.17 + (index % 3) * 0.02,
          h: 0.12 + ((index + 1) % 2) * 0.02,
          r: -0.2 + row * 0.08 + stack * 0.03,
          color: ["#fff7df", "#f6edd2", "#efe4c7", "#fffaf0"][index % 4]!,
        };
      },
    );

    const folders = [
      {
        x: cx + 0.28,
        y: cy + 0.013,
        z: cz + 0.0,
        w: 0.24,
        h: 0.17,
        d: 0.035,
        color: "#d6a447",
        r: 0.16,
      },
      ...(visibleTaskCount >= 5
        ? [
            {
              x: cx + 0.06,
              y: cy + 0.018,
              z: cz + 0.14,
              w: 0.22,
              h: 0.16,
              d: 0.04,
              color: "#9d5f3f",
              r: -0.08,
            },
          ]
        : []),
    ];

    const stickyNotes = Array.from(
      { length: Math.min(2 + Math.floor(visibleTaskCount / 3), 5) },
      (_, index) => ({
        x: cx + -0.1 + index * 0.08,
        y: cy + 0.012 + index * 0.002,
        z: cz + -0.14 - (index % 2) * 0.04,
        color: ["#f7db5e", "#ffb35c", "#97d7f6", "#c0e56e", "#ff8fa3"][
          index % 5
        ]!,
        r: -0.15 + index * 0.08,
      }),
    );

    const binders =
      visibleTaskCount >= 7
        ? [
            {
              x: cx + -0.24,
              y: cy + 0.04,
              z: cz + -0.06,
              w: 0.12,
              h: 0.12,
              d: 0.18,
              color: "#5d7bb0",
              r: -0.08,
            },
            {
              x: cx + -0.14,
              y: cy + 0.047,
              z: cz + -0.1,
              w: 0.12,
              h: 0.13,
              d: 0.19,
              color: "#6f8b3d",
              r: 0.03,
            },
          ]
        : [];

    return {
      papers,
      folders,
      stickyNotes,
      binders,
    };
  }, [kanbanTaskCount]);

  useEffect(() => {
    const highlightActive = isSelected || (isHovered && editMode);
    cloned.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const nextMats = mats.map((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          return material;
        }
        const hasOwnMaterial = Boolean(
          material.userData?.furnitureInstanceMaterial,
        );
        let nextMaterial = material;
        if (highlightActive && !hasOwnMaterial) {
          nextMaterial = material.clone();
          nextMaterial.userData = {
            ...material.userData,
            furnitureInstanceMaterial: true,
          };
        }
        if (!("emissive" in nextMaterial)) {
          return nextMaterial;
        }
        if (isSelected) {
          nextMaterial.emissive.set("#fbbf24");
          nextMaterial.emissiveIntensity = 0.35;
        } else if (isHovered && editMode) {
          nextMaterial.emissive.set("#4a90d9");
          nextMaterial.emissiveIntensity = 0.25;
        } else {
          nextMaterial.emissive.set("#000000");
          nextMaterial.emissiveIntensity = 0;
        }
        return nextMaterial;
      });
      mesh.material = Array.isArray(mesh.material) ? nextMats : nextMats[0];
    });
  }, [cloned, editMode, isHovered, isSelected]);

  return (
    <group
      position={[wx, yOffset, wz]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(item._uid);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onPointerOver(item._uid);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        onPointerOut();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(item._uid);
      }}
    >
      <group position={[pivotX, 0, pivotZ]} rotation={[0, rotY, 0]}>
        <group position={[-pivotX, 0, -pivotZ]} scale={scale}>
          <primitive object={cloned} />
        </group>
        {itemType === "kanban_board" ? (
          <>
            {kanbanTaskCount > 0 ? (
              <>
                {/* Monitor. */}
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.02,
                    KANBAN_CLUTTER_OFFSET.y + 0.1,
                    KANBAN_CLUTTER_OFFSET.z + -0.16,
                  ]}
                  rotation={[0, -0.28, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[0.22, 0.16, 0.03]} />
                  <meshStandardMaterial
                    color="#30374a"
                    roughness={0.48}
                    metalness={0.18}
                  />
                </mesh>
                {/* Keyboard. */}
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.02,
                    KANBAN_CLUTTER_OFFSET.y + 0.01,
                    KANBAN_CLUTTER_OFFSET.z + -0.03,
                  ]}
                  rotation={[-Math.PI / 2, -0.1, 0]}
                  castShadow
                >
                  <boxGeometry args={[0.22, 0.018, 0.09]} />
                  <meshStandardMaterial
                    color="#d8dce4"
                    roughness={0.82}
                    metalness={0.08}
                  />
                </mesh>
                {/* Mug. */}
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.24,
                    KANBAN_CLUTTER_OFFSET.y + 0.03,
                    KANBAN_CLUTTER_OFFSET.z + -0.17,
                  ]}
                  rotation={[-Math.PI / 2, 0.14, 0]}
                  castShadow
                >
                  <cylinderGeometry args={[0.04, 0.04, 0.09, 18]} />
                  <meshStandardMaterial
                    color="#2d4f73"
                    roughness={0.68}
                    metalness={0.12}
                  />
                </mesh>
                {/* Book stack. */}
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.34,
                    KANBAN_CLUTTER_OFFSET.y + 0.04,
                    KANBAN_CLUTTER_OFFSET.z + -0.06,
                  ]}
                  rotation={[0, 0.2, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[0.17, 0.05, 0.24]} />
                  <meshStandardMaterial
                    color="#bcc5d0"
                    roughness={0.78}
                    metalness={0.12}
                  />
                </mesh>
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.34,
                    KANBAN_CLUTTER_OFFSET.y + 0.07,
                    KANBAN_CLUTTER_OFFSET.z + -0.06,
                  ]}
                  rotation={[0, 0.2, 0]}
                  castShadow
                >
                  <boxGeometry args={[0.17, 0.012, 0.24]} />
                  <meshStandardMaterial
                    color="#eef2f4"
                    roughness={0.92}
                    metalness={0.03}
                  />
                </mesh>
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.34,
                    KANBAN_CLUTTER_OFFSET.y + 0.095,
                    KANBAN_CLUTTER_OFFSET.z + -0.06,
                  ]}
                  rotation={[0, 0.2, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[0.17, 0.05, 0.24]} />
                  <meshStandardMaterial
                    color="#cbd3db"
                    roughness={0.8}
                    metalness={0.1}
                  />
                </mesh>
                <mesh
                  position={[
                    KANBAN_CLUTTER_OFFSET.x + 0.34,
                    KANBAN_CLUTTER_OFFSET.y + 0.125,
                    KANBAN_CLUTTER_OFFSET.z + -0.06,
                  ]}
                  rotation={[0, 0.2, 0]}
                  castShadow
                >
                  <boxGeometry args={[0.17, 0.012, 0.24]} />
                  <meshStandardMaterial
                    color="#fffdf7"
                    roughness={0.94}
                    metalness={0.02}
                  />
                </mesh>
              </>
            ) : null}
            {kanbanDeskLoadout.papers.map((paper, index) => (
              <mesh
                key={`kanban-paper-${index}`}
                position={[paper.x, paper.y, paper.z]}
                rotation={[-Math.PI / 2, paper.r, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[paper.w, 0.018, paper.h]} />
                <meshStandardMaterial
                  color={paper.color}
                  roughness={0.94}
                  metalness={0.02}
                />
              </mesh>
            ))}
            {kanbanDeskLoadout.folders.map((folder, index) => (
              <mesh
                key={`kanban-folder-${index}`}
                position={[folder.x, folder.y, folder.z]}
                rotation={[-Math.PI / 2, folder.r, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[folder.w, folder.d, folder.h]} />
                <meshStandardMaterial
                  color={folder.color}
                  roughness={0.84}
                  metalness={0.06}
                />
              </mesh>
            ))}
            {kanbanDeskLoadout.stickyNotes.map((note, index) => (
              <mesh
                key={`kanban-sticky-${index}`}
                position={[note.x, note.y, note.z]}
                rotation={[-Math.PI / 2, note.r, 0]}
                castShadow
              >
                <boxGeometry args={[0.075, 0.014, 0.075]} />
                <meshStandardMaterial
                  color={note.color}
                  roughness={0.95}
                  metalness={0.01}
                />
              </mesh>
            ))}
            {kanbanDeskLoadout.binders.map((binder, index) => (
              <mesh
                key={`kanban-binder-${index}`}
                position={[binder.x, binder.y, binder.z]}
                rotation={[0, binder.r, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[binder.w, binder.h, binder.d]} />
                <meshStandardMaterial
                  color={binder.color}
                  roughness={0.74}
                  metalness={0.08}
                />
              </mesh>
            ))}
          </>
        ) : null}
      </group>
    </group>
  );
}

export function PlacementGhost({
  itemType,
  position,
}: {
  itemType: string;
  position: [number, number, number];
}) {
  const glbPath = FURNITURE_GLB[itemType] ?? FURNITURE_GLB.table_rect;
  const { scene } = useGLTF(glbPath);
  const template = useMemo(
    () =>
      resolveFurnitureTemplate({
        glbPath,
        itemColor: undefined,
        itemType,
        scene,
      }),
    [glbPath, itemType, scene],
  );
  const cloned = useMemo(() => template.clone(true), [template]);
  const scale = FURNITURE_SCALE[itemType] ?? [1, 1, 1];
  const rotY = FURNITURE_ROTATION[itemType] ?? 0;

  return (
    <group position={position} rotation={[0, rotY, 0]} scale={scale}>
      <primitive object={cloned} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

[...new Set(Object.values(FURNITURE_GLB))].forEach((path) =>
  useGLTF.preload(path),
);
