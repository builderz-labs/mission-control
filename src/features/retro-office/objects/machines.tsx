import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { SCALE } from "@/features/retro-office/core/constants";
import {
  getItemBaseSize,
  getItemRotationRadians,
  toWorld,
} from "@/features/retro-office/core/geometry";
import { InteractiveFurnitureModelProps } from "@/features/retro-office/objects/types";

export function AtmMachineModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#69f0da"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered ? 0.2 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.45, -depthWorld * 0.1]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.9, 0.9, depthWorld * 0.8]} />
          <meshStandardMaterial
            color="#1f2937"
            roughness={0.7}
            metalness={0.1}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.95, -depthWorld * 0.1]}>
          <boxGeometry args={[widthWorld * 0.86, 0.1, depthWorld * 0.76]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0.95, depthWorld * 0.29]}>
          <planeGeometry args={[widthWorld * 0.8, 0.08]} />
          <meshStandardMaterial
            color="#0ea5e9"
            emissive="#0ea5e9"
            emissiveIntensity={0.8}
          />
        </mesh>
        <Text
          position={[0, 0.95, depthWorld * 0.3]}
          fontSize={0.06}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
        >
          ATM
        </Text>

        <group position={[0, 0.6, depthWorld * 0.35]}>
          <mesh receiveShadow>
            <boxGeometry args={[widthWorld * 0.92, 0.5, depthWorld * 0.5]} />
            <meshStandardMaterial color="#d1d5db" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.1, depthWorld * 0.25 + 0.02]} rotation={[-0.2, 0, 0]}>
            <boxGeometry args={[widthWorld * 0.7, 0.28, 0.05]} />
            <meshStandardMaterial color="#000000" roughness={0.2} metalness={0.8} />
          </mesh>
          <mesh position={[0, 0.1, depthWorld * 0.25 + 0.046]} rotation={[-0.2, 0, 0]}>
            <planeGeometry args={[widthWorld * 0.6, 0.22]} />
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#06b6d4"
              emissiveIntensity={0.5}
              roughness={0.2}
            />
          </mesh>
          <Text
            position={[0, 0.1, depthWorld * 0.25 + 0.05]}
            rotation={[-0.2, 0, 0]}
            fontSize={0.045}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            WELCOME
          </Text>
          <Text
            position={[0, 0.06, depthWorld * 0.25 + 0.05]}
            rotation={[-0.2, 0, 0]}
            fontSize={0.02}
            color="#ccfbf1"
            anchorX="center"
            anchorY="middle"
          >
            INSERT CARD
          </Text>
          <mesh
            position={[-widthWorld * 0.42, 0.1, depthWorld * 0.25 + 0.05]}
            rotation={[0, 0.2, 0]}
          >
            <boxGeometry args={[0.04, 0.3, 0.3]} />
            <meshStandardMaterial color="#9ca3af" />
          </mesh>
          <mesh
            position={[widthWorld * 0.42, 0.1, depthWorld * 0.25 + 0.05]}
            rotation={[0, -0.2, 0]}
          >
            <boxGeometry args={[0.04, 0.3, 0.3]} />
            <meshStandardMaterial color="#9ca3af" />
          </mesh>
          <mesh position={[0, -0.15, depthWorld * 0.25 + 0.08]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[widthWorld * 0.92, 0.05, 0.25]} />
            <meshStandardMaterial color="#d1d5db" roughness={0.4} metalness={0.3} />
          </mesh>
          <group position={[0, -0.14, depthWorld * 0.25 + 0.11]} rotation={[0.2, 0, 0]}>
            <mesh position={[0, 0.01, 0]}>
              <boxGeometry args={[widthWorld * 0.25, 0.01, 0.12]} />
              <meshStandardMaterial color="#374151" />
            </mesh>
            {Array.from({ length: 12 }).map((_, index) => {
              const column = index % 3;
              const row = Math.floor(index / 3);

              return (
                <mesh
                  key={index}
                  position={[(column - 1) * 0.025, 0.015, (row - 1.5) * 0.025]}
                >
                  <boxGeometry args={[0.015, 0.005, 0.015]} />
                  <meshStandardMaterial color="#f3f4f6" />
                </mesh>
              );
            })}
          </group>
          <group
            position={[widthWorld * 0.25, -0.14, depthWorld * 0.25 + 0.11]}
            rotation={[0.2, 0, 0]}
          >
            <mesh position={[0, 0.01, 0]}>
              <boxGeometry args={[0.08, 0.02, 0.1]} />
              <meshStandardMaterial color="#1f2937" />
            </mesh>
            <mesh position={[0, 0.021, 0]}>
              <planeGeometry args={[0.06, 0.008]} />
              <meshStandardMaterial
                color="#10b981"
                emissive="#10b981"
                emissiveIntensity={2}
              />
            </mesh>
          </group>
          <mesh position={[0, -0.35, depthWorld * 0.25 + 0.05]}>
            <boxGeometry args={[widthWorld * 0.6, 0.08, 0.05]} />
            <meshStandardMaterial color="#4b5563" metalness={0.6} roughness={0.2} />
          </mesh>
          <mesh position={[0, -0.35, depthWorld * 0.25 + 0.076]}>
            <planeGeometry args={[widthWorld * 0.5, 0.02]} />
            <meshStandardMaterial color="#000000" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function PhoneBoothModel({
  item,
  isSelected,
  isHovered,
  doorOpen = false,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#7dd3fc"
      : "#000000";
  const highlightIntensity = isSelected ? 0.3 : isHovered ? 0.18 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        {/* Base */}
        <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.05, depthWorld]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>

        {/* Roof */}
        <mesh position={[0, 2.175, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.05, depthWorld]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.5}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>

        {/* Roof Top Accent / Sign Block */}
        <mesh position={[0, 2.25, 0]} receiveShadow>
          <boxGeometry args={[widthWorld * 0.9, 0.1, depthWorld * 0.9]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} />
        </mesh>
        <Text
          position={[0, 2.25, depthWorld * 0.451]}
          fontSize={0.06}
          color="#38bdf8"
          anchorX="center"
          anchorY="middle"
        >
          PHONE
        </Text>

        {/* Back Wall */}
        <mesh position={[0, 1.1, -depthWorld / 2 + 0.025]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 2.1, 0.05]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>

        {/* Left Wall (Glass) */}
        <mesh position={[-widthWorld / 2 + 0.025, 1.1, 0]} receiveShadow>
          <boxGeometry args={[0.05, 2.1, depthWorld]} />
          <meshStandardMaterial
            color="#bae6fd"
            transparent
            opacity={0.2}
            roughness={0.1}
            metalness={0.8}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>

        {/* Right Wall (Glass) */}
        <mesh position={[widthWorld / 2 - 0.025, 1.1, 0]} receiveShadow>
          <boxGeometry args={[0.05, 2.1, depthWorld]} />
          <meshStandardMaterial
            color="#bae6fd"
            transparent
            opacity={0.2}
            roughness={0.1}
            metalness={0.8}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>

        {/* Front Left Frame */}
        <mesh position={[-widthWorld / 2 + 0.05, 1.1, depthWorld / 2 - 0.025]} castShadow receiveShadow>
          <boxGeometry args={[0.1, 2.1, 0.05]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>

        {/* Front Right Frame */}
        <mesh position={[widthWorld / 2 - 0.05, 1.1, depthWorld / 2 - 0.025]} castShadow receiveShadow>
          <boxGeometry args={[0.1, 2.1, 0.05]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>

        <mesh
          position={[
            doorOpen ? widthWorld * 0.18 : 0,
            1.1,
            depthWorld / 2 - 0.03,
          ]}
          receiveShadow
        >
          <boxGeometry args={[widthWorld * 0.72, 2.02, 0.04]} />
          <meshStandardMaterial
            color="#dbeafe"
            transparent
            opacity={doorOpen ? 0.14 : 0.2}
            roughness={0.08}
            metalness={0.85}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity * 0.7}
          />
        </mesh>

        {/* Shelf */}
        <mesh position={[0, 1.0, -depthWorld / 2 + 0.15]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.8, 0.04, 0.25]} />
          <meshStandardMaterial color="#475569" roughness={0.7} />
        </mesh>

        {/* Phone unit on back wall */}
        <group position={[0, 1.2, -depthWorld / 2 + 0.08]}>
          <mesh>
            <boxGeometry args={[0.2, 0.3, 0.06]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh position={[0, -0.05, 0.035]}>
            <boxGeometry args={[0.12, 0.12, 0.02]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[0, 0.08, 0.035]}>
            <planeGeometry args={[0.14, 0.08]} />
            <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[-0.15, 0, 0.02]}>
            <boxGeometry args={[0.04, 0.25, 0.04]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh position={[-0.1, -0.15, 0.02]} rotation={[0, 0, Math.PI / 4]}>
            <cylinderGeometry args={[0.005, 0.005, 0.15, 8]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        </group>

        {/* Acoustic panels inside */}
        <mesh position={[0, 1.5, -depthWorld / 2 + 0.06]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.8, 0.6, 0.02]} />
          <meshStandardMaterial color="#334155" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

export function SmsBoothModel({
  item,
  isSelected,
  isHovered,
  doorOpen = false,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#7dd3fc"
      : "#000000";
  const highlightIntensity = isSelected ? 0.28 : isHovered ? 0.16 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.05, depthWorld]} />
          <meshStandardMaterial color="#172033" roughness={0.84} />
        </mesh>
        <mesh position={[0, 1.625, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.05, depthWorld]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.5}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 1.69, 0]} receiveShadow>
          <boxGeometry args={[widthWorld * 0.88, 0.08, depthWorld * 0.88]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} />
        </mesh>
        <Text
          position={[0, 1.69, depthWorld * 0.445]}
          fontSize={0.055}
          color="#22d3ee"
          anchorX="center"
          anchorY="middle"
        >
          SMS
        </Text>
        <mesh position={[0, 0.8, -depthWorld / 2 + 0.025]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 1.5, 0.05]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>
        <mesh position={[-widthWorld / 2 + 0.025, 0.8, 0]} receiveShadow>
          <boxGeometry args={[0.05, 1.5, depthWorld]} />
          <meshStandardMaterial
            color="#cffafe"
            transparent
            opacity={0.18}
            roughness={0.1}
            metalness={0.8}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[widthWorld / 2 - 0.025, 0.8, 0]} receiveShadow>
          <boxGeometry args={[0.05, 1.5, depthWorld]} />
          <meshStandardMaterial
            color="#cffafe"
            transparent
            opacity={0.18}
            roughness={0.1}
            metalness={0.8}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[-widthWorld / 2 + 0.05, 0.8, depthWorld / 2 - 0.025]} castShadow receiveShadow>
          <boxGeometry args={[0.1, 1.5, 0.05]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>
        <mesh position={[widthWorld / 2 - 0.05, 0.8, depthWorld / 2 - 0.025]} castShadow receiveShadow>
          <boxGeometry args={[0.1, 1.5, 0.05]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>
        <mesh
          position={[
            doorOpen ? widthWorld * 0.15 : 0,
            0.8,
            depthWorld / 2 - 0.03,
          ]}
          receiveShadow
        >
          <boxGeometry args={[widthWorld * 0.68, 1.42, 0.04]} />
          <meshStandardMaterial
            color="#dbeafe"
            transparent
            opacity={doorOpen ? 0.12 : 0.18}
            roughness={0.08}
            metalness={0.85}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity * 0.7}
          />
        </mesh>
        <mesh position={[0, 0.68, -depthWorld / 2 + 0.17]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.78, 0.06, 0.28]} />
          <meshStandardMaterial color="#475569" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.88, -depthWorld / 2 + 0.15]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.18, 0.08, 0.06]} />
          <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.9, -depthWorld / 2 + 0.184]}>
          <planeGeometry args={[widthWorld * 0.13, 0.05]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#60a5fa"
            emissiveIntensity={0.8}
          />
        </mesh>
        <mesh position={[0, 0.84, -depthWorld / 2 + 0.165]}>
          <boxGeometry args={[widthWorld * 0.2, 0.01, 0.08]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
    </group>
  );
}

export function ServerRackModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#38bdf8"
      : "#000000";
  const highlightIntensity = isSelected ? 0.3 : isHovered ? 0.15 : 0;
  const rackHeight = 1.45;
  const serverUnits = 8;
  const unitHeight = (rackHeight - 0.2) / serverUnits;

  const lightColors = useMemo(() => {
    const colors = ["#22c55e", "#3b82f6", "#ef4444", "#eab308", "#ec4899"];
    let seed = 0;
    for (let index = 0; index < item._uid.length; index += 1) {
      seed += item._uid.charCodeAt(index);
    }
    return Array.from({ length: serverUnits }).map((_, index) => ({
      status: colors[(seed + index) % colors.length],
      activity: (seed + index) % 3 === 0,
    }));
  }, [item._uid]);

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, rackHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, rackHeight, depthWorld]} />
          <meshStandardMaterial
            color="#111827"
            roughness={0.4}
            metalness={0.6}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <group position={[0, 0.1 + unitHeight / 2, depthWorld / 2 + 0.01]}>
          {lightColors.map((config, index) => (
            <group key={index} position={[0, index * unitHeight, 0]}>
              <mesh receiveShadow>
                <boxGeometry args={[widthWorld * 0.88, unitHeight * 0.9, 0.02]} />
                <meshStandardMaterial color="#1f2937" roughness={0.6} metalness={0.4} />
              </mesh>
              <mesh position={[-widthWorld * 0.38, 0, 0.015]}>
                <planeGeometry args={[0.03, 0.03]} />
                <meshStandardMaterial
                  color={config.status}
                  emissive={config.status}
                  emissiveIntensity={2}
                  toneMapped={false}
                />
              </mesh>
              {config.activity ? (
                <group position={[-widthWorld * 0.28, 0, 0.015]}>
                  <mesh position={[0, 0.015, 0]}>
                    <planeGeometry args={[0.015, 0.015]} />
                    <meshStandardMaterial
                      color="#22d3ee"
                      emissive="#22d3ee"
                      emissiveIntensity={3}
                      toneMapped={false}
                    />
                  </mesh>
                  <mesh position={[0.025, 0, 0]}>
                    <planeGeometry args={[0.015, 0.015]} />
                    <meshStandardMaterial
                      color="#22d3ee"
                      emissive="#22d3ee"
                      emissiveIntensity={1.5}
                      toneMapped={false}
                    />
                  </mesh>
                </group>
              ) : null}
              <mesh position={[widthWorld * 0.15, 0, 0.015]}>
                <planeGeometry args={[widthWorld * 0.4, unitHeight * 0.6]} />
                <meshStandardMaterial color="#000000" opacity={0.6} transparent />
              </mesh>
            </group>
          ))}
        </group>
        <mesh position={[0, rackHeight / 2, depthWorld / 2 + 0.03]}>
          <boxGeometry args={[widthWorld, rackHeight, 0.02]} />
          <meshStandardMaterial
            color="#a5f3fc"
            opacity={0.15}
            transparent
            roughness={0.08}
            metalness={0.1}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, rackHeight + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[widthWorld * 0.8, depthWorld * 0.8]} />
          <meshStandardMaterial color="#1f2937" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

export function ServerTerminalModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#60a5fa"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.92, 0.64, depthWorld * 0.86]} />
          <meshStandardMaterial
            color="#101827"
            roughness={0.62}
            metalness={0.18}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.46, depthWorld * 0.44]} rotation={[-0.18, 0, 0]}>
          <planeGeometry args={[widthWorld * 0.64, 0.26]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#60a5fa"
            emissiveIntensity={0.7}
          />
        </mesh>
        <Text
          position={[0, 0.47, depthWorld * 0.45]}
          rotation={[-0.18, 0, 0]}
          fontSize={0.05}
          color="#eff6ff"
          anchorX="center"
          anchorY="middle"
        >
          GITHUB
        </Text>
        <Text
          position={[0, 0.4, depthWorld * 0.45]}
          rotation={[-0.18, 0, 0]}
          fontSize={0.018}
          color="#bfdbfe"
          anchorX="center"
          anchorY="middle"
        >
          REVIEW STATION
        </Text>
        <mesh position={[0, 0.11, depthWorld * 0.42]}>
          <boxGeometry args={[widthWorld * 0.66, 0.06, 0.12]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.14} />
        </mesh>
      </group>
    </group>
  );
}

export function QaTerminalModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#c084fc"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.37, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.74, depthWorld * 0.88]} />
          <meshStandardMaterial
            color="#12081c"
            roughness={0.5}
            metalness={0.26}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.58, 0]} castShadow>
          <boxGeometry args={[widthWorld * 0.94, 0.04, depthWorld * 0.9]} />
          <meshStandardMaterial color="#231235" metalness={0.55} roughness={0.24} />
        </mesh>
        {[-widthWorld * 0.2, widthWorld * 0.2].map((x, index) => (
          <group key={x} position={[x, 0.52, depthWorld * 0.41]} rotation={[-0.16, 0, 0]}>
            <mesh>
              <planeGeometry args={[widthWorld * 0.28, 0.24]} />
              <meshStandardMaterial
                color={index === 0 ? "#8b5cf6" : "#38bdf8"}
                emissive={index === 0 ? "#8b5cf6" : "#38bdf8"}
                emissiveIntensity={0.9}
              />
            </mesh>
            <mesh position={[0, 0, 0.01]}>
              <planeGeometry args={[widthWorld * 0.24, 0.18]} />
              <meshStandardMaterial
                color={index === 0 ? "#ede9fe" : "#e0f2fe"}
                emissive={index === 0 ? "#c084fc" : "#38bdf8"}
                emissiveIntensity={0.18}
              />
            </mesh>
          </group>
        ))}
        <Text
          position={[0, 0.73, 0]}
          fontSize={0.034}
          color="#faf5ff"
          anchorX="center"
          anchorY="middle"
        >
          QA LAB
        </Text>
        <Text
          position={[0, 0.66, 0]}
          fontSize={0.014}
          color="#ddd6fe"
          anchorX="center"
          anchorY="middle"
        >
          TEST CONSOLE
        </Text>
        <mesh position={[0, 0.16, depthWorld * 0.4]}>
          <boxGeometry args={[widthWorld * 0.78, 0.07, 0.15]} />
          <meshStandardMaterial color="#241237" roughness={0.48} metalness={0.22} />
        </mesh>
        <mesh position={[0, 0.2, depthWorld * 0.44]}>
          <boxGeometry args={[widthWorld * 0.48, 0.02, 0.07]} />
          <meshStandardMaterial color="#111827" metalness={0.55} roughness={0.2} />
        </mesh>
        {[-widthWorld * 0.44, widthWorld * 0.44].map((x) => (
          <mesh key={x} position={[x, 0.4, 0]}>
            <boxGeometry args={[0.03, 0.64, 0.03]} />
            <meshStandardMaterial
              color="#8b5cf6"
              emissive="#8b5cf6"
              emissiveIntensity={0.7}
              metalness={0.35}
              roughness={0.28}
            />
          </mesh>
        ))}
        {[-widthWorld * 0.3, 0, widthWorld * 0.3].map((x, index) => (
          <mesh key={x} position={[x, 0.09, depthWorld * 0.47]}>
            <boxGeometry args={[0.05, 0.01, 0.02]} />
            <meshStandardMaterial
              color={index === 1 ? "#22c55e" : "#38bdf8"}
              emissive={index === 1 ? "#22c55e" : "#38bdf8"}
              emissiveIntensity={1.2}
            />
          </mesh>
        ))}
        <mesh position={[widthWorld * 0.36, 0.3, -depthWorld * 0.18]} rotation={[0, -0.3, 0]}>
          <boxGeometry args={[0.08, 0.18, 0.08]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.55} />
        </mesh>
        <mesh position={[widthWorld * 0.36, 0.39, -depthWorld * 0.18]} rotation={[0, -0.3, 0]}>
          <planeGeometry args={[0.05, 0.07]} />
          <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  );
}

export function DeviceRackModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#38bdf8"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered ? 0.18 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 1.0, depthWorld * 0.92]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.45}
            metalness={0.58}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        {[-0.26, 0, 0.26].map((offset, columnIndex) => (
          <group key={offset} position={[offset, 0.22, depthWorld / 2 + 0.01]}>
            {[0, 0.24, 0.48].map((level, rowIndex) => (
              <group key={`${offset}:${level}`} position={[0, level, 0]}>
                <mesh>
                  <boxGeometry args={[widthWorld * 0.24, 0.16, 0.03]} />
                  <meshStandardMaterial color="#111827" />
                </mesh>
                <mesh position={[0, 0, 0.018]}>
                  <planeGeometry args={[widthWorld * 0.18, 0.09]} />
                  <meshStandardMaterial
                    color={
                      rowIndex === 1
                        ? "#22c55e"
                        : columnIndex === 1
                          ? "#8b5cf6"
                          : "#38bdf8"
                    }
                    emissive={
                      rowIndex === 1
                        ? "#22c55e"
                        : columnIndex === 1
                          ? "#8b5cf6"
                          : "#38bdf8"
                    }
                    emissiveIntensity={0.8}
                  />
                </mesh>
              </group>
            ))}
          </group>
        ))}
        {[-widthWorld * 0.47, widthWorld * 0.47].map((x) => (
          <mesh key={x} position={[x, 0.5, 0]}>
            <boxGeometry args={[0.02, 0.96, depthWorld * 0.94]} />
            <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.55} />
          </mesh>
        ))}
        <Text
          position={[0, 1.05, 0]}
          fontSize={0.04}
          color="#e0f2fe"
          anchorX="center"
          anchorY="middle"
        >
          DEVICES
        </Text>
      </group>
    </group>
  );
}

export function TestBenchModel({
  item,
  isSelected,
  isHovered,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered
      ? "#c084fc"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered ? 0.18 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.08, depthWorld]} />
          <meshStandardMaterial
            color="#312e81"
            roughness={0.62}
            metalness={0.14}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        {[-widthWorld * 0.34, widthWorld * 0.34].map((x) =>
          [-depthWorld * 0.34, depthWorld * 0.34].map((z) => (
            <mesh key={`${x}:${z}`} position={[x, 0.22, z]} castShadow>
              <boxGeometry args={[0.05, 0.44, 0.05]} />
              <meshStandardMaterial color="#1f2937" roughness={0.52} metalness={0.2} />
            </mesh>
          )),
        )}
        <mesh position={[-widthWorld * 0.18, 0.52, 0]}>
          <boxGeometry args={[widthWorld * 0.22, 0.12, 0.02]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[-widthWorld * 0.18, 0.52, 0.016]}>
          <planeGeometry args={[widthWorld * 0.18, 0.08]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[widthWorld * 0.16, 0.5, 0]} rotation={[0, 0.16, 0]}>
          <boxGeometry args={[0.1, 0.02, 0.14]} />
          <meshStandardMaterial color="#111827" roughness={0.24} metalness={0.58} />
        </mesh>
        <mesh position={[widthWorld * 0.04, 0.52, -depthWorld * 0.22]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.12, 0.02, 0.08]} />
          <meshStandardMaterial color="#1f2937" roughness={0.18} metalness={0.65} />
        </mesh>
        <mesh position={[widthWorld * 0.04, 0.54, -depthWorld * 0.22]} rotation={[0, 0.3, 0]}>
          <planeGeometry args={[0.09, 0.05]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[-widthWorld * 0.36, 0.5, -depthWorld * 0.16]}>
          <cylinderGeometry args={[0.015, 0.022, 0.18, 14]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.32} metalness={0.7} />
        </mesh>
        <mesh position={[-widthWorld * 0.31, 0.6, -depthWorld * 0.1]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.12, 0.018, 0.018]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.28} metalness={0.65} />
        </mesh>
        <Text
          position={[0, 0.64, 0]}
          fontSize={0.034}
          color="#ede9fe"
          anchorX="center"
          anchorY="middle"
        >
          TEST BENCH
        </Text>
      </group>
    </group>
  );
}

export function PingPongTableModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const width = (item.w ?? 100) * SCALE;
  const depth = (item.h ?? 60) * SCALE;
  const [wx, , wz] = toWorld(item.x, item.y);
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#4a90d9"
      : "#000000";
  const highlightIntensity = isSelected ? 0.35 : isHovered && editMode ? 0.22 : 0;
  const topThickness = 0.045;
  const topHeight = 0.44;
  const lineThickness = 0.012;
  const lineRaise = topThickness * 0.55;

  return (
    <group
      position={[wx, item.elevation ?? 0, wz]}
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
      <group position={[width / 2, 0, depth / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, topHeight, 0]} receiveShadow>
          <boxGeometry args={[width, topThickness, depth]} />
          <meshStandardMaterial
            color="#1f6f4a"
            roughness={0.72}
            metalness={0.08}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, topHeight - 0.01, 0]}>
          <boxGeometry args={[width + 0.02, 0.018, depth + 0.02]} />
          <meshStandardMaterial
            color="#d7dde3"
            roughness={0.5}
            metalness={0.15}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity * 0.5}
          />
        </mesh>
        <mesh position={[0, topHeight + lineRaise, 0]}>
          <boxGeometry args={[width * 0.94, lineThickness, 0.02]} />
          <meshStandardMaterial color="#f7f8fb" roughness={0.45} />
        </mesh>
        <mesh position={[0, topHeight + lineRaise, depth * 0.48]}>
          <boxGeometry args={[width * 0.94, lineThickness, 0.02]} />
          <meshStandardMaterial color="#f7f8fb" roughness={0.45} />
        </mesh>
        <mesh position={[0, topHeight + lineRaise, -depth * 0.48]}>
          <boxGeometry args={[width * 0.94, lineThickness, 0.02]} />
          <meshStandardMaterial color="#f7f8fb" roughness={0.45} />
        </mesh>
        <mesh position={[0, topHeight + lineRaise, 0]}>
          <boxGeometry args={[0.02, lineThickness, depth * 0.92]} />
          <meshStandardMaterial color="#f7f8fb" roughness={0.45} />
        </mesh>
        <mesh position={[0, topHeight + 0.075, 0]}>
          <boxGeometry args={[0.012, 0.11, depth * 0.92]} />
          <meshStandardMaterial
            color="#e8edf2"
            roughness={0.85}
            metalness={0.04}
            transparent
            opacity={0.9}
          />
        </mesh>
        <mesh position={[0, topHeight + 0.06, -depth * 0.46]}>
          <boxGeometry args={[0.02, 0.14, 0.02]} />
          <meshStandardMaterial
            color="#2f3a44"
            roughness={0.7}
            metalness={0.2}
          />
        </mesh>
        <mesh position={[0, topHeight + 0.06, depth * 0.46]}>
          <boxGeometry args={[0.02, 0.14, 0.02]} />
          <meshStandardMaterial
            color="#2f3a44"
            roughness={0.7}
            metalness={0.2}
          />
        </mesh>
        <mesh position={[-width * 0.34, 0.21, -depth * 0.3]}>
          <boxGeometry args={[0.06, 0.38, 0.06]} />
          <meshStandardMaterial
            color="#55616c"
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[width * 0.34, 0.21, -depth * 0.3]}>
          <boxGeometry args={[0.06, 0.38, 0.06]} />
          <meshStandardMaterial
            color="#55616c"
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[-width * 0.34, 0.21, depth * 0.3]}>
          <boxGeometry args={[0.06, 0.38, 0.06]} />
          <meshStandardMaterial
            color="#55616c"
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[width * 0.34, 0.21, depth * 0.3]}>
          <boxGeometry args={[0.06, 0.38, 0.06]} />
          <meshStandardMaterial
            color="#55616c"
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[width * 0.46, 0.03, 0.06]} />
          <meshStandardMaterial
            color="#55616c"
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>
      </group>
    </group>
  );
}

export function TreadmillModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#38bdf8"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.12, 0]} receiveShadow castShadow>
          <boxGeometry args={[widthWorld, 0.24, depthWorld]} />
          <meshStandardMaterial
            color="#1f2937"
            roughness={0.58}
            metalness={0.22}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[widthWorld * 0.84, 0.05, depthWorld * 0.72]} />
          <meshStandardMaterial color="#111827" roughness={0.3} metalness={0.55} />
        </mesh>
        <mesh position={[0, 0.67, -depthWorld * 0.18]} castShadow>
          <boxGeometry args={[widthWorld * 0.16, 0.9, 0.06]} />
          <meshStandardMaterial color="#4b5563" roughness={0.52} metalness={0.2} />
        </mesh>
        <mesh position={[0, 1.12, -depthWorld * 0.18]} castShadow>
          <boxGeometry args={[widthWorld * 0.6, 0.16, 0.08]} />
          <meshStandardMaterial color="#111827" roughness={0.28} metalness={0.5} />
        </mesh>
        <mesh position={[0, 1.12, -depthWorld * 0.12]}>
          <planeGeometry args={[widthWorld * 0.45, 0.08]} />
          <meshStandardMaterial
            color="#22d3ee"
            emissive="#22d3ee"
            emissiveIntensity={1.4}
          />
        </mesh>
        <mesh position={[-widthWorld * 0.34, 0.4, 0]}>
          <boxGeometry args={[0.05, 0.56, 0.05]} />
          <meshStandardMaterial color="#6b7280" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[widthWorld * 0.34, 0.4, 0]}>
          <boxGeometry args={[0.05, 0.56, 0.05]} />
          <meshStandardMaterial color="#6b7280" metalness={0.35} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

export function WeightBenchModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#60a5fa"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[-widthWorld * 0.08, 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.46, 0.1, depthWorld * 0.64]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.34}
            metalness={0.22}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[widthWorld * 0.18, 0.55, 0]} rotation={[0, 0, -0.32]} castShadow>
          <boxGeometry args={[widthWorld * 0.3, 0.1, depthWorld * 0.64]} />
          <meshStandardMaterial color="#111827" roughness={0.34} metalness={0.22} />
        </mesh>
        <mesh position={[-widthWorld * 0.15, 0.18, -depthWorld * 0.22]} rotation={[0, 0, 0.22]}>
          <boxGeometry args={[0.04, 0.36, 0.04]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.55} roughness={0.2} />
        </mesh>
        <mesh position={[-widthWorld * 0.15, 0.18, depthWorld * 0.22]} rotation={[0, 0, -0.22]}>
          <boxGeometry args={[0.04, 0.36, 0.04]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.55} roughness={0.2} />
        </mesh>
        <mesh position={[widthWorld * 0.33, 0.78, -depthWorld * 0.24]} castShadow>
          <boxGeometry args={[0.04, 0.9, 0.04]} />
          <meshStandardMaterial color="#d1d5db" metalness={0.65} roughness={0.18} />
        </mesh>
        <mesh position={[widthWorld * 0.33, 0.78, depthWorld * 0.24]} castShadow>
          <boxGeometry args={[0.04, 0.9, 0.04]} />
          <meshStandardMaterial color="#d1d5db" metalness={0.65} roughness={0.18} />
        </mesh>
        <mesh position={[widthWorld * 0.33, 1.1, 0]}>
          <boxGeometry args={[0.04, 0.04, depthWorld * 0.7]} />
          <meshStandardMaterial color="#d1d5db" metalness={0.65} roughness={0.18} />
        </mesh>
        <mesh position={[widthWorld * 0.33, 1.1, -depthWorld * 0.34]}>
          <cylinderGeometry args={[0.055, 0.055, 0.05, 18]} />
          <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.5} />
        </mesh>
        <mesh position={[widthWorld * 0.33, 1.1, depthWorld * 0.34]}>
          <cylinderGeometry args={[0.055, 0.055, 0.05, 18]} />
          <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

export function DumbbellRackModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#67e8f9"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.84, 0.06, depthWorld * 0.34]} />
          <meshStandardMaterial
            color="#4b5563"
            roughness={0.48}
            metalness={0.5}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.78, 0.06, depthWorld * 0.34]} />
          <meshStandardMaterial color="#6b7280" roughness={0.48} metalness={0.5} />
        </mesh>
        <mesh position={[-widthWorld * 0.34, 0.18, 0]} rotation={[0, 0, 0.18]}>
          <boxGeometry args={[0.04, 0.38, 0.04]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.28} metalness={0.75} />
        </mesh>
        <mesh position={[widthWorld * 0.34, 0.18, 0]} rotation={[0, 0, -0.18]}>
          <boxGeometry args={[0.04, 0.38, 0.04]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.28} metalness={0.75} />
        </mesh>
        {([-0.26, -0.12, 0.02, 0.16, 0.3] as const).map((offsetX, index) => (
          <group key={index} position={[widthWorld * offsetX, index % 2 === 0 ? 0.32 : 0.54, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.028, 0.028, 0.11, 18]} />
              <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.55} />
            </mesh>
            <mesh position={[0, 0, depthWorld * 0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.028, 0.028, 0.11, 18]} />
              <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.55} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

export function ExerciseBikeModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#60a5fa"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[widthWorld * 0.74, 0.08, depthWorld * 0.24]} />
          <meshStandardMaterial
            color="#334155"
            roughness={0.56}
            metalness={0.25}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[-widthWorld * 0.12, 0.35, 0]} rotation={[0, 0, 0.24]} castShadow>
          <boxGeometry args={[0.05, 0.58, 0.05]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.34} metalness={0.7} />
        </mesh>
        <mesh position={[widthWorld * 0.12, 0.35, 0]} rotation={[0, 0, -0.3]} castShadow>
          <boxGeometry args={[0.05, 0.58, 0.05]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.34} metalness={0.7} />
        </mesh>
        <mesh position={[-widthWorld * 0.06, 0.62, 0]} castShadow>
          <boxGeometry args={[0.08, 0.08, 0.16]} />
          <meshStandardMaterial color="#111827" roughness={0.35} metalness={0.18} />
        </mesh>
        <mesh position={[widthWorld * 0.14, 0.92, 0]} rotation={[0, 0, -0.18]} castShadow>
          <boxGeometry args={[0.045, 0.72, 0.045]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.34} metalness={0.7} />
        </mesh>
        <mesh position={[widthWorld * 0.2, 1.2, depthWorld * 0.02]}>
          <boxGeometry args={[0.26, 0.06, 0.04]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.25} metalness={0.72} />
        </mesh>
        <mesh position={[0, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.026, 18, 48]} />
          <meshStandardMaterial color="#0f172a" roughness={0.34} metalness={0.48} />
        </mesh>
      </group>
    </group>
  );
}

export function PunchingBagModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#f97316"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, widthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 1.22, 0]}>
          <boxGeometry args={[0.22, 0.04, 0.22]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.12, 0.1, 1.16, 24]} />
          <meshStandardMaterial
            color="#b91c1c"
            roughness={0.52}
            metalness={0.06}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 1.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.24, 12]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.11, 0.18, 24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.92} metalness={0.08} />
        </mesh>
      </group>
    </group>
  );
}

export function RowingMachineModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#38bdf8"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <boxGeometry args={[widthWorld * 0.9, 0.08, depthWorld * 0.28]} />
          <meshStandardMaterial
            color="#334155"
            roughness={0.55}
            metalness={0.25}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[-widthWorld * 0.24, 0.18, 0]}>
          <boxGeometry args={[0.18, 0.12, depthWorld * 0.52]} />
          <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.18} />
        </mesh>
        <mesh position={[widthWorld * 0.2, 0.26, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.08, 20]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.4} />
        </mesh>
        <mesh position={[widthWorld * 0.2, 0.26, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.1, 18]} />
          <meshStandardMaterial color="#f97316" roughness={0.35} metalness={0.15} />
        </mesh>
        <mesh position={[-widthWorld * 0.06, 0.36, 0]} rotation={[0, 0, 0.2]}>
          <boxGeometry args={[0.04, 0.54, 0.04]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.28} metalness={0.72} />
        </mesh>
        <mesh position={[widthWorld * 0.1, 0.72, 0]}>
          <boxGeometry args={[0.3, 0.04, 0.04]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.24} metalness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

export function KettlebellRackModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#67e8f9"
      : "#000000";
  const highlightIntensity = isSelected ? 0.34 : isHovered && editMode ? 0.22 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld * 0.86, 0.06, depthWorld * 0.4]} />
          <meshStandardMaterial
            color="#475569"
            roughness={0.5}
            metalness={0.45}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[-widthWorld * 0.32, 0.14, 0]}>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.26} metalness={0.76} />
        </mesh>
        <mesh position={[widthWorld * 0.32, 0.14, 0]}>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.26} metalness={0.76} />
        </mesh>
        {([-0.24, -0.08, 0.08, 0.24] as const).map((offsetX, index) => (
          <group key={index} position={[widthWorld * offsetX, 0.38, 0]}>
            <mesh>
              <sphereGeometry args={[0.038, 16, 16]} />
              <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.5} />
            </mesh>
            <mesh position={[0, 0.035, 0]}>
              <torusGeometry args={[0.018, 0.005, 10, 18]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.28} metalness={0.75} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

export function YogaMatModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const matColor = item.color ?? "#0f766e";
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#5eead4"
      : "#000000";
  const highlightIntensity = isSelected ? 0.3 : isHovered && editMode ? 0.18 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.012, 0]} receiveShadow>
          <boxGeometry args={[widthWorld, 0.024, depthWorld]} />
          <meshStandardMaterial
            color={matColor}
            roughness={0.88}
            metalness={0.02}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.024, -depthWorld * 0.44]}>
          <cylinderGeometry args={[0.028, 0.028, widthWorld * 0.96, 18]} />
          <meshStandardMaterial color="#0f172a" roughness={0.55} metalness={0.14} />
        </mesh>
      </group>
    </group>
  );
}

export function EaselModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#fb7185"
      : "#000000";
  const highlightIntensity = isSelected ? 0.32 : isHovered && editMode ? 0.18 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.56, 0.12]} castShadow>
          <boxGeometry args={[0.028, 1.05, 0.028]} />
          <meshStandardMaterial color="#8b5e34" roughness={0.76} />
        </mesh>
        <mesh position={[-0.18, 0.38, -0.02]} rotation={[0.18, 0, 0.16]} castShadow>
          <boxGeometry args={[0.028, 0.88, 0.028]} />
          <meshStandardMaterial color="#8b5e34" roughness={0.76} />
        </mesh>
        <mesh position={[0.18, 0.38, -0.02]} rotation={[0.18, 0, -0.16]} castShadow>
          <boxGeometry args={[0.028, 0.88, 0.028]} />
          <meshStandardMaterial color="#8b5e34" roughness={0.76} />
        </mesh>
        <mesh position={[0, 0.3, 0.02]} castShadow>
          <boxGeometry args={[0.32, 0.03, 0.04]} />
          <meshStandardMaterial color="#7c5530" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.54, -0.03]} castShadow receiveShadow>
          <boxGeometry args={[0.34, 0.44, 0.03]} />
          <meshStandardMaterial
            color="#fef3c7"
            roughness={0.94}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        <mesh position={[0, 0.55, -0.012]}>
          <planeGeometry args={[0.26, 0.26]} />
          <meshStandardMaterial color="#fb7185" emissive="#fb7185" emissiveIntensity={0.12} />
        </mesh>
        <mesh position={[-0.05, 0.57, -0.011]}>
          <planeGeometry args={[0.09, 0.06]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.1} />
        </mesh>
        <mesh position={[0.07, 0.49, -0.011]}>
          <planeGeometry args={[0.12, 0.07]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.08} />
        </mesh>
      </group>
    </group>
  );
}

export function PaintTableModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#f472b6"
      : "#000000";
  const highlightIntensity = isSelected ? 0.3 : isHovered && editMode ? 0.16 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.06, depthWorld]} />
          <meshStandardMaterial
            color="#5b3c22"
            roughness={0.7}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        {[
          [-widthWorld * 0.38, 0.2, -depthWorld * 0.34],
          [widthWorld * 0.38, 0.2, -depthWorld * 0.34],
          [-widthWorld * 0.38, 0.2, depthWorld * 0.34],
          [widthWorld * 0.38, 0.2, depthWorld * 0.34],
        ].map(([x, y, z], index) => (
          <mesh key={index} position={[x, y, z]} castShadow>
            <boxGeometry args={[0.035, 0.38, 0.035]} />
            <meshStandardMaterial color="#7c5530" roughness={0.76} />
          </mesh>
        ))}
        <mesh position={[-0.18, 0.46, -0.06]}>
          <cylinderGeometry args={[0.08, 0.08, 0.01, 18]} />
          <meshStandardMaterial color="#1d4ed8" />
        </mesh>
        <mesh position={[-0.04, 0.46, 0.04]}>
          <cylinderGeometry args={[0.07, 0.07, 0.01, 18]} />
          <meshStandardMaterial color="#fb7185" />
        </mesh>
        <mesh position={[0.1, 0.46, -0.02]}>
          <cylinderGeometry args={[0.065, 0.065, 0.01, 18]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
        <mesh position={[0.24, 0.49, 0.08]} castShadow>
          <boxGeometry args={[0.09, 0.1, 0.09]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.35} metalness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

export function ArtRackModel({
  item,
  isSelected,
  isHovered,
  editMode,
  onPointerDown,
  onPointerOver,
  onPointerOut,
  onClick,
}: InteractiveFurnitureModelProps) {
  const [wx, , wz] = toWorld(item.x, item.y);
  const { width, height } = getItemBaseSize(item);
  const widthWorld = width * SCALE;
  const depthWorld = height * SCALE;
  const rotY = getItemRotationRadians(item);
  const highlightColor = isSelected
    ? "#fbbf24"
    : isHovered && editMode
      ? "#fda4af"
      : "#000000";
  const highlightIntensity = isSelected ? 0.28 : isHovered && editMode ? 0.14 : 0;

  return (
    <group
      position={[wx, 0, wz]}
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
      <group position={[widthWorld / 2, 0, depthWorld / 2]} rotation={[0, rotY, 0]}>
        <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[widthWorld, 0.96, depthWorld]} />
          <meshStandardMaterial
            color="#2d1b24"
            roughness={0.68}
            emissive={highlightColor}
            emissiveIntensity={highlightIntensity}
          />
        </mesh>
        {[
          { y: 0.18, tone: "#38bdf8", label: "A1" },
          { y: 0.48, tone: "#f59e0b", label: "B2" },
          { y: 0.78, tone: "#fb7185", label: "C3" },
        ].map((shelf) => (
          <group key={shelf.label} position={[0, shelf.y, depthWorld / 2 + 0.012]}>
            <mesh>
              <boxGeometry args={[widthWorld * 0.86, 0.18, 0.02]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
            <Text
              position={[0, 0, 0.015]}
              fontSize={0.04}
              color={shelf.tone}
              anchorX="center"
              anchorY="middle"
            >
              {shelf.label}
            </Text>
          </group>
        ))}
      </group>
    </group>
  );
}
