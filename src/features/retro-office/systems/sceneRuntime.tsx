"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  PING_PONG_BALL_RADIUS,
  PING_PONG_TABLE_SURFACE_Y,
} from "@/features/retro-office/core/constants";
import { toWorld } from "@/features/retro-office/core/geometry";
import type { RenderAgent } from "@/features/retro-office/core/types";

export function FloorRaycaster({
  enabled,
  onMove,
  onClick,
}: {
  enabled: boolean;
  onMove: (wx: number, wz: number) => void;
  onClick: (wx: number, wz: number) => void;
}) {
  const { camera, raycaster, gl } = useThree();
  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const target = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const project = (clientX: number, clientY: number): { x: number; z: number } | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(floorPlane, target)) {
        return { x: target.x, z: target.z };
      }
      return null;
    };

    const handleMove = (event: PointerEvent) => {
      const point = project(event.clientX, event.clientY);
      if (point) onMove(point.x, point.z);
    };
    const handleClick = (event: MouseEvent) => {
      const point = project(event.clientX, event.clientY);
      if (point) onClick(point.x, point.z);
    };

    gl.domElement.addEventListener("pointermove", handleMove);
    gl.domElement.addEventListener("click", handleClick);
    return () => {
      gl.domElement.removeEventListener("pointermove", handleMove);
      gl.domElement.removeEventListener("click", handleClick);
    };
  }, [enabled, camera, raycaster, gl, floorPlane, onMove, onClick]);

  return null;
}

export function PingPongBall({
  agentsRef,
}: {
  agentsRef: RefObject<RenderAgent[]>;
}) {
  const ballRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const shadowMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (!ballRef.current || !shadowRef.current || !shadowMatRef.current) return;
    const allPlayers = (agentsRef.current ?? [])
      .filter(
        (agent) =>
          agent.pingPongUntil !== undefined &&
          agent.pingPongTableUid !== undefined &&
          agent.pingPongSide !== undefined,
      )
      .sort((left, right) => (left.pingPongSide ?? 0) - (right.pingPongSide ?? 0));
    const activeTableUid = allPlayers[0]?.pingPongTableUid;
    const players = activeTableUid
      ? allPlayers.filter((agent) => agent.pingPongTableUid === activeTableUid)
      : [];

    if (players.length < 2) {
      ballRef.current.visible = false;
      shadowRef.current.visible = false;
      return;
    }

    const [leftPlayer, rightPlayer] = players;
    if (!leftPlayer || !rightPlayer) {
      ballRef.current.visible = false;
      shadowRef.current.visible = false;
      return;
    }
    if (leftPlayer.state === "walking" || rightPlayer.state === "walking") {
      ballRef.current.visible = false;
      shadowRef.current.visible = false;
      return;
    }

    const [leftWx, , leftWz] = toWorld(leftPlayer.x + 18, leftPlayer.y);
    const [rightWx, , rightWz] = toWorld(rightPlayer.x - 18, rightPlayer.y);
    const phase = (Date.now() % 1200) / 1200;
    const forwardLeg = phase < 0.5;
    const strikerWx = forwardLeg ? leftWx : rightWx;
    const strikerWz = forwardLeg ? leftWz : rightWz;
    const receiverWx = forwardLeg ? rightWx : leftWx;
    const receiverWz = forwardLeg ? rightWz : leftWz;
    const localPhase = forwardLeg ? phase * 2 : (phase - 0.5) * 2;
    const bounceY = PING_PONG_TABLE_SURFACE_Y + PING_PONG_BALL_RADIUS;
    const paddleY = bounceY + 0.19;
    const netArcY = bounceY + 0.25;
    const englishOffset = (forwardLeg ? 1 : -1) * 0.05;
    const firstBounceX = THREE.MathUtils.lerp(strikerWx, receiverWx, 0.28);
    const firstBounceZ = THREE.MathUtils.lerp(strikerWz, receiverWz, 0.28) + englishOffset;
    const secondBounceX = THREE.MathUtils.lerp(strikerWx, receiverWx, 0.72);
    const secondBounceZ =
      THREE.MathUtils.lerp(strikerWz, receiverWz, 0.72) - englishOffset * 0.8;
    let ballX = strikerWx;
    let ballY = paddleY;
    let ballZ = strikerWz;

    if (localPhase < 0.24) {
      const t = localPhase / 0.24;
      ballX = THREE.MathUtils.lerp(strikerWx, firstBounceX, t);
      ballZ = THREE.MathUtils.lerp(strikerWz, firstBounceZ, t);
      ballY =
        THREE.MathUtils.lerp(paddleY, bounceY, t) + Math.sin(t * Math.PI) * 0.035;
    } else if (localPhase < 0.76) {
      const t = (localPhase - 0.24) / 0.52;
      ballX = THREE.MathUtils.lerp(firstBounceX, secondBounceX, t);
      ballZ = THREE.MathUtils.lerp(firstBounceZ, secondBounceZ, t);
      ballY = bounceY + Math.sin(t * Math.PI) * (netArcY - bounceY);
    } else {
      const t = (localPhase - 0.76) / 0.24;
      ballX = THREE.MathUtils.lerp(secondBounceX, receiverWx, t);
      ballZ = THREE.MathUtils.lerp(secondBounceZ, receiverWz, t);
      ballY =
        THREE.MathUtils.lerp(bounceY, paddleY, t) + Math.sin(t * Math.PI) * 0.03;
    }

    ballRef.current.visible = true;
    ballRef.current.position.set(ballX, ballY, ballZ);
    shadowRef.current.visible = true;
    shadowRef.current.position.set(ballX, PING_PONG_TABLE_SURFACE_Y + 0.004, ballZ);
    const shadowLift = THREE.MathUtils.clamp((ballY - bounceY) / 0.28, 0, 1);
    const shadowScale = THREE.MathUtils.lerp(0.14, 0.26, shadowLift);
    shadowRef.current.scale.set(shadowScale, shadowScale, shadowScale);
    shadowMatRef.current.opacity = THREE.MathUtils.lerp(0.34, 0.12, shadowLift);
  });

  return (
    <group>
      <mesh
        ref={shadowRef}
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
      >
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial
          ref={shadowMatRef}
          color="#09110d"
          transparent
          opacity={0.24}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={ballRef} visible={false}>
        <sphereGeometry args={[PING_PONG_BALL_RADIUS, 16, 12]} />
        <meshStandardMaterial
          color="#ff8c1a"
          roughness={0.18}
          emissive="#ffb347"
          emissiveIntensity={0.85}
        />
      </mesh>
    </group>
  );
}

export function GameLoop({ tick }: { tick: () => void }) {
  useFrame(() => tick());
  return null;
}

export function SpotlightEffect({
  agentId,
  agentsRef,
  agentLookupRef,
}: {
  agentId: string | null;
  agentsRef: RefObject<RenderAgent[]>;
  agentLookupRef?: RefObject<Map<string, RenderAgent>>;
}) {
  const lightRef = useRef<THREE.SpotLight>(null);
  const progressRef = useRef(0);

  useFrame((_, delta) => {
    if (!lightRef.current) return;
    if (agentId) {
      progressRef.current = Math.min(1, progressRef.current + delta / 0.4);
    } else {
      progressRef.current = Math.max(0, progressRef.current - delta / 0.6);
    }
    const bell = Math.sin(progressRef.current * Math.PI);
    lightRef.current.intensity = bell * 6;

    const agent =
      (agentId ? agentLookupRef?.current?.get(agentId) : undefined) ??
      agentsRef.current?.find((candidate) => candidate.id === agentId);
    if (agent) {
      const [wx, , wz] = toWorld(agent.x, agent.y);
      lightRef.current.position.set(wx, 5, wz);
      lightRef.current.target.position.set(wx, 0, wz);
      lightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <spotLight
      ref={lightRef}
      color="#ffe8a0"
      intensity={0}
      angle={0.35}
      penumbra={0.5}
      distance={12}
      castShadow={false}
    />
  );
}
