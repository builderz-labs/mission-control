import { SCALE } from "@/features/retro-office/core/constants";
import { toWorld } from "@/features/retro-office/core/geometry";
import { BasicFurnitureModelProps } from "@/features/retro-office/objects/types";

export function VendingMachineModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);

  return (
    <group
      position={[wx, 0, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.35, 0.8, 0.26]} />
        <meshStandardMaterial
          color="#2a3040"
          roughness={0.7}
          metalness={0.22}
        />
      </mesh>
      <mesh position={[0, 0.46, 0.132]}>
        <boxGeometry args={[0.29, 0.58, 0.01]} />
        <meshStandardMaterial color="#c02020" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.57, 0.138]}>
        <boxGeometry args={[0.22, 0.26, 0.006]} />
        <meshStandardMaterial
          color="#a8d4e8"
          roughness={0.1}
          metalness={0.3}
          transparent
          opacity={0.75}
        />
      </mesh>
      <mesh position={[0, 0.29, 0.138]}>
        <boxGeometry args={[0.18, 0.1, 0.006]} />
        <meshStandardMaterial color="#1a1a2a" roughness={0.7} />
      </mesh>
      <mesh position={[0.09, 0.3, 0.142]}>
        <boxGeometry args={[0.038, 0.013, 0.005]} />
        <meshStandardMaterial color="#888" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.07, 0.132]}>
        <boxGeometry args={[0.2, 0.055, 0.02]} />
        <meshStandardMaterial color="#111" roughness={0.9} />
      </mesh>
    </group>
  );
}

export function DishwasherModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);

  return (
    <group
      position={[wx, 0, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.44, 0.38, 0.32]} />
        <meshStandardMaterial
          color="#d1d5db"
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.44, 0.04, 0.32]} />
        <meshStandardMaterial
          color="#c8c4be"
          roughness={0.6}
          metalness={0.05}
        />
      </mesh>
      <mesh position={[0, 0.25, 0.165]}>
        <boxGeometry args={[0.42, 0.28, 0.01]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.2} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.36, 0.165]}>
        <boxGeometry args={[0.42, 0.06, 0.01]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0.15, 0.36, 0.17]}>
        <circleGeometry args={[0.006, 8]} />
        <meshBasicMaterial color="#10b981" />
      </mesh>
    </group>
  );
}

export function StoveModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);

  return (
    <group
      position={[wx, 0, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.44, 0.38, 0.32]} />
        <meshStandardMaterial
          color="#2a2a2a"
          roughness={0.4}
          metalness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.44, 0.04, 0.32]} />
        <meshStandardMaterial
          color="#1a1a1a"
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      {[
        [-0.1, -0.08],
        [0.1, -0.08],
        [-0.1, 0.08],
        [0.1, 0.08],
      ].map(([burnerX, burnerZ], index) => (
        <mesh key={index} position={[burnerX, 0.415, burnerZ]}>
          <cylinderGeometry args={[0.06, 0.06, 0.01, 16]} />
          <meshStandardMaterial color="#111" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.2, 0.165]}>
        <boxGeometry args={[0.38, 0.24, 0.01]} />
        <meshStandardMaterial color="#111" roughness={0.1} metalness={0.9} />
      </mesh>
      <mesh position={[0, 0.3, 0.18]}>
        <boxGeometry args={[0.3, 0.015, 0.015]} />
        <meshStandardMaterial color="#ccc" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}

export function MicrowaveModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const yBase = (item.elevation ?? 0) + 0.42;

  return (
    <group
      position={[wx, yBase, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.35, 0.2, 0.25]} />
        <meshStandardMaterial
          color="#e0e0e0"
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      <mesh position={[-0.05, 0.1, 0.13]}>
        <planeGeometry args={[0.2, 0.14]} />
        <meshStandardMaterial color="#111" roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[0.12, 0.1, 0.13]}>
        <planeGeometry args={[0.08, 0.14]} />
        <meshStandardMaterial color="#ccc" roughness={0.5} />
      </mesh>
    </group>
  );
}

export function WallCabinetModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const width = (item.w ?? 80) * SCALE;
  const elevation = item.elevation ?? 0;
  const yPos = elevation > 0 ? elevation : 0.9;

  return (
    <group
      position={[wx, yPos, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh>
        <boxGeometry args={[width, 0.4, 0.25]} />
        <meshStandardMaterial color="#3c4248" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0, 0.13]}>
        <boxGeometry args={[width - 0.02, 0.38, 0.01]} />
        <meshStandardMaterial color="#4a5058" roughness={0.6} />
      </mesh>
      {width > 0.4 ? (
        <mesh position={[0, 0, 0.135]}>
          <boxGeometry args={[0.005, 0.38, 0.002]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
      ) : null}
      <mesh position={[0.02, -0.1, 0.14]}>
        <boxGeometry args={[0.01, 0.06, 0.01]} />
        <meshStandardMaterial color="#ccc" metalness={0.8} />
      </mesh>
      {width > 0.4 ? (
        <mesh position={[-0.02, -0.1, 0.14]}>
          <boxGeometry args={[0.01, 0.06, 0.01]} />
          <meshStandardMaterial color="#ccc" metalness={0.8} />
        </mesh>
      ) : null}
    </group>
  );
}

export function SinkModel({
  item,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  editMode,
}: BasicFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);

  return (
    <group
      position={[wx, 0, wz]}
      onPointerDown={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerDown?.(item._uid);
      }}
      onPointerOver={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOver?.(item._uid);
      }}
      onPointerOut={(event) => {
        if (!editMode) return;
        event.stopPropagation();
        onPointerOut?.();
      }}
    >
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.44, 0.38, 0.32]} />
        <meshStandardMaterial
          color="#b0aca6"
          roughness={0.7}
          metalness={0.02}
        />
      </mesh>
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.44, 0.04, 0.32]} />
        <meshStandardMaterial
          color="#c8c4be"
          roughness={0.6}
          metalness={0.05}
        />
      </mesh>
      <mesh position={[0, 0.385, 0]}>
        <boxGeometry args={[0.27, 0.04, 0.22]} />
        <meshStandardMaterial
          color="#9ebccc"
          roughness={0.3}
          metalness={0.12}
        />
      </mesh>
      <mesh position={[0, 0.44, -0.1]}>
        <boxGeometry args={[0.03, 0.06, 0.03]} />
        <meshStandardMaterial color="#909090" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.48, -0.04]}>
        <boxGeometry args={[0.025, 0.025, 0.1]} />
        <meshStandardMaterial color="#909090" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}
