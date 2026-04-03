/**
 * JARVIS — Floating particle field.
 *
 * Tiny pinpoint dots drifting in 3D space. Think: stars in slow motion,
 * or bioluminescent plankton in dark water.
 */

import * as THREE from "three";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface Orb {
  setState(s: OrbState): void;
  setAnalyser(a: AnalyserNode | null): void;
  destroy(): void;
}

export function createOrb(canvas: HTMLCanvasElement): Orb {
  let destroyed = false;
  const N = 4000;

  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x030305, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    1000
  );
  camera.position.z = 80; // FAR back so particles are tiny

  // ── Create particles ──
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const phase = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    // Spread in a sphere, radius ~25
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.5) * 25;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
    phase[i] = Math.random() * 1000;
  }

  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  // Simple point material — just dots
  const mat = new THREE.PointsMaterial({
    color: 0x4ca8e8,
    size: 0.4,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  scene.add(new THREE.Points(geo, mat));

  // ── State ──
  let state: OrbState = "idle";
  let targetRadius = 25;
  let currentRadius = 25;
  let targetSpeed = 0.3;
  let currentSpeed = 0.3;
  let targetBright = 0.6;
  let currentBright = 0.6;
  let targetSize = 0.4;
  let currentSize = 0.4;

  // ── Audio ──
  let analyser: AnalyserNode | null = null;
  let freqData = new Uint8Array(64);
  let bass = 0;

  const clock = new THREE.Clock();

  function animate() {
    if (destroyed) return;
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta(), 0.05);

    // State targets
    switch (state) {
      case "idle":
        targetRadius = 28; targetSpeed = 0.2; targetBright = 0.5; targetSize = 0.35; break;
      case "listening":
        targetRadius = 22; targetSpeed = 0.3; targetBright = 0.65; targetSize = 0.4; break;
      case "thinking":
        targetRadius = 16; targetSpeed = 0.6; targetBright = 0.7; targetSize = 0.3; break;
      case "speaking":
        targetRadius = 25; targetSpeed = 0.2; targetBright = 0.65; targetSize = 0.38; break;
    }

    // Smooth lerp
    currentRadius += (targetRadius - currentRadius) * 0.02;
    currentSpeed += (targetSpeed - currentSpeed) * 0.02;
    currentBright += (targetBright - currentBright) * 0.02;
    currentSize += (targetSize - currentSize) * 0.02;

    // Audio
    bass = 0;
    if (analyser) {
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += freqData[i];
      bass = (sum / (8 * 255));
    }

    // Update particles
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = p.array as Float32Array;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      let x = a[i3], y = a[i3 + 1], z = a[i3 + 2];

      // Multi-layered organic drift — slow flowing currents
      const px = phase[i];
      // Primary slow drift
      vel[i3] += Math.sin(t * 0.05 + px) * 0.001 * currentSpeed;
      vel[i3 + 1] += Math.cos(t * 0.06 + px * 1.3) * 0.001 * currentSpeed;
      vel[i3 + 2] += Math.sin(t * 0.055 + px * 0.7) * 0.001 * currentSpeed;
      // Secondary slower layer for variety
      vel[i3] += Math.sin(t * 0.02 + px * 2.1 + y * 0.1) * 0.0008 * currentSpeed;
      vel[i3 + 1] += Math.cos(t * 0.025 + px * 1.7 + z * 0.1) * 0.0008 * currentSpeed;
      vel[i3 + 2] += Math.sin(t * 0.022 + px * 0.9 + x * 0.1) * 0.0008 * currentSpeed;

      // Pull toward center (strength based on how far outside target radius)
      const dist = Math.sqrt(x * x + y * y + z * z) || 0.01;
      const pull = Math.max(0, dist - currentRadius) * 0.002 + 0.0003;
      vel[i3] -= (x / dist) * pull;
      vel[i3 + 1] -= (y / dist) * pull;
      vel[i3 + 2] -= (z / dist) * pull;

      // Audio push outward — subtle, not explosive
      if (bass > 0.05) {
        vel[i3] += (x / dist) * bass * 0.02;
        vel[i3 + 1] += (y / dist) * bass * 0.02;
        vel[i3 + 2] += (z / dist) * bass * 0.02;
      }

      // Heavy damping for buttery smooth movement
      vel[i3] *= 0.992;
      vel[i3 + 1] *= 0.992;
      vel[i3 + 2] *= 0.992;

      a[i3] += vel[i3];
      a[i3 + 1] += vel[i3 + 1];
      a[i3 + 2] += vel[i3 + 2];
    }

    p.needsUpdate = true;

    // Material updates — subtle audio influence
    mat.opacity = currentBright + bass * 0.08;
    mat.size = currentSize + bass * 0.05;

    // Very slow orbit — barely perceptible
    camera.position.x = Math.sin(t * 0.02) * 5;
    camera.position.y = Math.cos(t * 0.03) * 3;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener("resize", onResize);
  animate();

  return {
    setState(s: OrbState) { state = s; },
    setAnalyser(a: AnalyserNode | null) {
      analyser = a;
      if (a) freqData = new Uint8Array(a.frequencyBinCount);
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    },
  };
}
