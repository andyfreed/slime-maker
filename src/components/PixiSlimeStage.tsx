import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { findCharm, findSparkle } from '../gameData';
import type { Slime } from '../types';

type InteractionKind = 'drag' | 'poke' | 'squish' | 'stretch' | 'bounce' | 'mega';

export interface PixiSlimeStageHandle {
  poke: () => void;
  squish: () => void;
  stretch: () => void;
  bounce: () => void;
  megaMorph: () => void;
  burst: (count?: number) => void;
}

interface PixiSlimeStageProps {
  slime: Slime | null;
  onInteract?: (kind: InteractionKind) => void;
}

interface StageControls {
  poke: () => void;
  squish: () => void;
  stretch: () => void;
  bounce: () => void;
  megaMorph: () => void;
  burst: (count?: number) => void;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  life: number;
  ttl: number;
}

interface SlimeFragment {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  origin: THREE.Vector3;
  life: number;
  reforming: boolean;
  scale: number;
}

interface MegaMorphState {
  active: boolean;
  phase: 'expand' | 'explode' | 'orbit' | 'reform' | 'none';
  time: number;
  phaseTime: number;
  hueShift: number;
  fragments: MegaFragment[];
  shockwaveScale: number;
  shockwaveOpacity: number;
  pulseCount: number;
}

interface MegaFragment {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  angle: number;
  radius: number;
  speed: number;
  yOffset: number;
  size: number;
  orbitAxis: THREE.Vector3;
}

const ULTRA_PRESET = {
  dpr: [1, 2] as [number, number],
  geometrySegments: 88,
  innerSegments: 64,
  rimSegments: 48,
  sparkleCount: 18,
  sparkleSegments: 14,
  burstScale: 1,
  burstCap: 30,
  deformEvery: 1,
  distortion: 0.13,
  distortionScale: 0.36,
  temporalDistortion: 0.17,
  chromaticAberration: 0.028,
  anisotropicBlur: 0.08,
  roughness: 0.06,
  transmissionSamples: 5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToColor(hex: string): THREE.Color {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#55efc4';
  return new THREE.Color(safe);
}

function lighten(hex: string, amount: number): THREE.Color {
  return hexToColor(hex).multiplyScalar(1 + amount);
}

function darken(hex: string, amount: number): THREE.Color {
  return hexToColor(hex).multiplyScalar(1 - amount);
}

function createEmojiTexture(emoji: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.font = '190px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function deriveIrisColor(slimeColor: string): THREE.Color {
  const base = hexToColor(slimeColor);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  hsl.h = (hsl.h + 0.5) % 1.0;
  hsl.s = Math.min(1, hsl.s + 0.3);
  hsl.l = clamp(hsl.l, 0.3, 0.55);
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
}

const SlimeScene = ({
  slime,
  onInteract,
  onReady,
}: {
  slime: Slime;
  onInteract?: (kind: InteractionKind) => void;
  onReady: (controls: StageControls | null) => void;
}) => {
  const { pointer, camera, scene } = useThree();
  const preset = ULTRA_PRESET;

  const rootRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const leftEyeGroupRef = useRef<THREE.Group>(null);
  const rightEyeGroupRef = useRef<THREE.Group>(null);
  const leftPupilRef = useRef<THREE.Mesh>(null);
  const rightPupilRef = useRef<THREE.Mesh>(null);
  const leftIrisRef = useRef<THREE.Mesh>(null);
  const rightIrisRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const sparkleRef = useRef<THREE.Group>(null);
  const particleLayerRef = useRef<THREE.Group>(null);
  const fragmentLayerRef = useRef<THREE.Group>(null);
  const megaLayerRef = useRef<THREE.Group>(null);
  const shockwaveRef = useRef<THREE.Mesh>(null);

  const burstParticlesRef = useRef<BurstParticle[]>([]);
  const fragmentsRef = useRef<SlimeFragment[]>([]);
  const isDraggingRef = useRef(false);
  const targetPosRef = useRef(new THREE.Vector3(0, -0.02, 0));
  const currentPosRef = useRef(new THREE.Vector3(0, -0.02, 0));
  const targetScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const currentScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const burstGlowRef = useRef(0);
  const deformFrameRef = useRef(0);
  const blinkRef = useRef(0);
  const blinkTimerRef = useRef(0);
  const lastPokeForceRef = useRef(0);
  const bodyVisibleRef = useRef(true);

  const megaStateRef = useRef<MegaMorphState>({
    active: false,
    phase: 'none',
    time: 0,
    phaseTime: 0,
    hueShift: 0,
    fragments: [],
    shockwaveScale: 0,
    shockwaveOpacity: 0,
    pulseCount: 0,
  });

  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, preset.geometrySegments, preset.geometrySegments),
    [preset.geometrySegments],
  );
  const innerGeometry = useMemo(
    () => new THREE.SphereGeometry(0.92, preset.innerSegments, preset.innerSegments),
    [preset.innerSegments],
  );
  const rimGeometry = useMemo(
    () => new THREE.SphereGeometry(1.03, preset.rimSegments, preset.rimSegments),
    [preset.rimSegments],
  );
  const burstGeometry = useMemo(() => new THREE.SphereGeometry(0.03, 8, 8), []);
  const fragmentGeometry = useMemo(() => new THREE.SphereGeometry(1, 32, 32), []);
  const megaFragGeometry = useMemo(() => new THREE.SphereGeometry(1, 24, 24), []);
  const shockwaveGeometry = useMemo(() => new THREE.RingGeometry(0.8, 1, 64), []);

  const basePositions = useMemo(
    () => Float32Array.from((geometry.attributes.position.array as Float32Array).slice()),
    [geometry],
  );
  const normals = useMemo(
    () => Float32Array.from((geometry.attributes.normal.array as Float32Array).slice()),
    [geometry],
  );

  const sparkle = useMemo(() => findSparkle(slime.sparkle), [slime.sparkle]);
  const charm = useMemo(() => findCharm(slime.charm), [slime.charm]);
  const irisColor = useMemo(() => deriveIrisColor(slime.color), [slime.color]);

  const sparklePoints = useMemo(() => {
    if (!sparkle || sparkle.id === 'none') return [];
    const rng = (index: number) => {
      const x = Math.sin(index * 97.221 + slime.id.length * 0.73) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: preset.sparkleCount }, (_, index) => {
      const phi = rng(index + 1) * Math.PI * 2;
      const cost = rng(index + 2) * 2 - 1;
      const sint = Math.sqrt(1 - cost * cost);
      const radius = 0.2 + rng(index + 3) * 0.62;
      return new THREE.Vector3(
        Math.cos(phi) * sint * radius,
        cost * radius,
        Math.sin(phi) * sint * radius,
      );
    });
  }, [preset.sparkleCount, slime.id, sparkle]);

  const charmTexture = useMemo(() => {
    if (!charm || charm.id === 'none') return null;
    return createEmojiTexture(charm.emoji);
  }, [charm]);

  useEffect(() => {
    scene.background = null;
    return () => {
      scene.background = null;
    };
  }, [scene]);

  useEffect(() => {
    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      targetPosRef.current.set(0, -0.02, 0);
      targetScaleRef.current.set(1, 1, 1);
      onInteract?.('drag');
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [onInteract]);

  useEffect(() => {
    const controls: StageControls = {
      poke: () => impulse('poke', 0.68, 1.35, 0.3),
      squish: () => impulse('squish', 1.55, 0.48, 0.45),
      stretch: () => impulse('stretch', 0.52, 1.55, 0.4),
      bounce: () => bounce(),
      megaMorph: () => mega(),
      burst: (count = 8) => spawnBurst(count),
    };
    onReady(controls);
    return () => {
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReady, onInteract]);

  useEffect(() => {
    camera.position.set(0, 0.12, 4.1);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useEffect(() => {
    return () => {
      burstParticlesRef.current.forEach((item) => {
        item.mesh.removeFromParent();
        item.material.dispose();
      });
      burstParticlesRef.current = [];
      fragmentsRef.current.forEach((f) => {
        f.mesh.removeFromParent();
        f.material.dispose();
      });
      fragmentsRef.current = [];
      cleanupMegaFragments();
      geometry.dispose();
      innerGeometry.dispose();
      rimGeometry.dispose();
      burstGeometry.dispose();
      fragmentGeometry.dispose();
      megaFragGeometry.dispose();
      shockwaveGeometry.dispose();
      if (charmTexture) charmTexture.dispose();
    };
  }, [burstGeometry, charmTexture, geometry, innerGeometry, rimGeometry, fragmentGeometry, megaFragGeometry, shockwaveGeometry]);

  const cleanupMegaFragments = (): void => {
    const state = megaStateRef.current;
    state.fragments.forEach((f) => {
      f.mesh.removeFromParent();
      f.material.dispose();
    });
    state.fragments = [];
  };

  const spawnBurst = (count: number): void => {
    if (!particleLayerRef.current) return;
    const scaledCount = clamp(Math.round(count * preset.burstScale), 2, preset.burstCap);
    const sparkleColor = sparkle?.color ? hexToColor(sparkle.color) : lighten(slime.color, 0.32);
    for (let i = 0; i < scaledCount; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: sparkleColor,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(burstGeometry, material);
      mesh.position.set(0, -0.02, 0.95);
      particleLayerRef.current.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.55 + Math.random() * 0.7;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        (Math.random() - 0.2) * speed + 0.4,
        (Math.random() - 0.5) * 0.5,
      );
      burstParticlesRef.current.push({
        mesh,
        material,
        velocity,
        life: 0,
        ttl: 0.45 + Math.random() * 0.28,
      });
    }
    burstGlowRef.current += Math.min(0.65, scaledCount * 0.045);
  };

  const spawnFragments = (count: number): void => {
    if (!fragmentLayerRef.current) return;
    const baseColor = hexToColor(slime.color);
    for (let i = 0; i < count; i++) {
      const size = 0.15 + Math.random() * 0.3;
      const material = new THREE.MeshPhysicalMaterial({
        color: baseColor.clone().multiplyScalar(0.85 + Math.random() * 0.3),
        transmission: 0.7,
        thickness: 0.6,
        roughness: 0.15,
        clearcoat: 0.8,
        ior: 1.15,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(fragmentGeometry, material);
      mesh.scale.setScalar(size);
      mesh.position.set(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.2 + 0.1,
      );
      fragmentLayerRef.current.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.3) * Math.PI;
      const speed = 1.8 + Math.random() * 2.2;
      fragmentsRef.current.push({
        mesh,
        material,
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(elevation) * speed,
          Math.sin(elevation) * speed + 1.0,
          Math.sin(angle) * Math.cos(elevation) * speed * 0.5,
        ),
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
        ),
        origin: mesh.position.clone(),
        life: 0,
        reforming: false,
        scale: size,
      });
    }
    bodyVisibleRef.current = false;
  };

  const impulse = (kind: InteractionKind, sx: number, sy: number, burst: number): void => {
    targetScaleRef.current.set(sx, sy, clamp((sx + sy) * 0.5, 0.6, 1.3));
    lastPokeForceRef.current = Math.abs(1 - sx) + Math.abs(1 - sy);

    if (lastPokeForceRef.current > 0.7 && fragmentsRef.current.length === 0 && !megaStateRef.current.active) {
      spawnFragments(6 + Math.floor(Math.random() * 4));
    }

    spawnBurst(8);
    burstGlowRef.current += burst;
    onInteract?.(kind);
    window.setTimeout(() => {
      if (isDraggingRef.current) return;
      targetScaleRef.current.set(1, 1, 1);
    }, 280);
  };

  const bounce = (): void => {
    targetPosRef.current.set(0, 0.75, 0);
    targetScaleRef.current.set(0.75, 1.4, 0.88);
    spawnBurst(10);
    burstGlowRef.current += 0.35;
    onInteract?.('bounce');
    window.setTimeout(() => {
      targetPosRef.current.set(0, -0.02, 0);
      targetScaleRef.current.set(1.3, 0.7, 1.2);
      window.setTimeout(() => {
        if (isDraggingRef.current) return;
        targetScaleRef.current.set(0.92, 1.08, 0.96);
        window.setTimeout(() => {
          if (isDraggingRef.current) return;
          targetScaleRef.current.set(1, 1, 1);
        }, 120);
      }, 150);
    }, 200);
  };

  const mega = (): void => {
    const state = megaStateRef.current;
    if (state.active) return;

    state.active = true;
    state.phase = 'expand';
    state.time = 0;
    state.phaseTime = 0;
    state.hueShift = 0;
    state.shockwaveScale = 0;
    state.shockwaveOpacity = 0;
    state.pulseCount = 0;
    cleanupMegaFragments();

    bodyVisibleRef.current = true;
    fragmentsRef.current.forEach((f) => {
      f.mesh.removeFromParent();
      f.material.dispose();
    });
    fragmentsRef.current = [];

    spawnBurst(25);
    burstGlowRef.current += 1.2;
    onInteract?.('mega');
  };

  const spawnMegaFragments = (count: number): void => {
    if (!megaLayerRef.current) return;
    const baseColor = hexToColor(slime.color);
    for (let i = 0; i < count; i++) {
      const size = 0.08 + Math.random() * 0.22;
      const hue = (i / count) * 360;
      const color = new THREE.Color().setHSL(hue / 360, 0.8, 0.55);
      const material = new THREE.MeshPhysicalMaterial({
        color: color,
        transmission: 0.5,
        thickness: 0.4,
        roughness: 0.1,
        clearcoat: 1,
        ior: 1.2,
        transparent: true,
        opacity: 0.95,
        emissive: baseColor,
        emissiveIntensity: 0.3,
      });
      const mesh = new THREE.Mesh(megaFragGeometry, material);
      mesh.scale.setScalar(size);
      megaLayerRef.current.add(mesh);

      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const orbitAxis = new THREE.Vector3(
        Math.random() - 0.5,
        1 + Math.random(),
        Math.random() - 0.5,
      ).normalize();

      megaStateRef.current.fragments.push({
        mesh,
        material,
        angle,
        radius: 0.5 + Math.random() * 1.5,
        speed: 2 + Math.random() * 3,
        yOffset: (Math.random() - 0.5) * 1.2,
        size,
        orbitAxis,
      });
    }
  };

  useFrame((state, delta) => {
    const d = clamp(delta * 60, 0, 2.4);
    const t = state.clock.elapsedTime;

    if (isDraggingRef.current) {
      targetPosRef.current.set(pointer.x * 1.6, pointer.y * 1.1 - 0.02, 0);
      const dist = Math.min(1, Math.hypot(pointer.x, pointer.y));
      const stretch = 1 + dist * 0.55;
      const squish = 1 - dist * 0.38;
      if (Math.abs(pointer.x) > Math.abs(pointer.y)) {
        targetScaleRef.current.set(stretch, squish, 1);
      } else {
        targetScaleRef.current.set(squish, stretch, 1);
      }
    }

    currentPosRef.current.lerp(targetPosRef.current, 0.12 * d);
    currentScaleRef.current.lerp(targetScaleRef.current, 0.14 * d);

    const breathe = 1 + Math.sin(t * 1.8) * 0.022;
    const megaActive = megaStateRef.current.active;

    if (rootRef.current) {
      rootRef.current.position.copy(currentPosRef.current);

      if (!megaActive) {
        rootRef.current.scale.set(
          currentScaleRef.current.x * breathe,
          currentScaleRef.current.y / breathe,
          currentScaleRef.current.z,
        );
        rootRef.current.rotation.z = Math.sin(t * 1.2) * 0.06;
        rootRef.current.rotation.x = Math.sin(t * 0.95) * 0.05;
      }
    }

    // --- Mega Morph animation ---
    if (megaActive) {
      const ms = megaStateRef.current;
      ms.time += delta;
      ms.phaseTime += delta;

      if (ms.phase === 'expand') {
        const progress = clamp(ms.phaseTime / 0.6, 0, 1);
        const scale = 1 + progress * 0.8;
        if (rootRef.current) {
          rootRef.current.scale.setScalar(scale);
          rootRef.current.rotation.z = Math.sin(ms.time * 12) * 0.15 * progress;
        }
        ms.hueShift = ms.time * 2;
        if (outerRef.current) {
          const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
          const baseHSL = { h: 0, s: 0, l: 0 };
          hexToColor(slime.color).getHSL(baseHSL);
          const shiftedColor = new THREE.Color().setHSL(
            (baseHSL.h + ms.hueShift) % 1,
            Math.min(1, baseHSL.s + 0.3),
            baseHSL.l,
          );
          if ('color' in mat) (mat as unknown as { color: THREE.Color }).color.copy(shiftedColor);
        }
        if (ms.phaseTime > 0.6) {
          ms.phase = 'explode';
          ms.phaseTime = 0;
          bodyVisibleRef.current = false;
          spawnMegaFragments(20);
          spawnBurst(30);
          burstGlowRef.current += 1.5;
          ms.shockwaveScale = 0.1;
          ms.shockwaveOpacity = 1;
        }
      } else if (ms.phase === 'explode') {
        const progress = clamp(ms.phaseTime / 0.4, 0, 1);
        ms.fragments.forEach((f) => {
          const r = f.radius * progress * 2;
          f.angle += delta * f.speed;
          f.mesh.position.set(
            Math.cos(f.angle) * r,
            f.yOffset * progress * 2 + Math.sin(f.angle * 0.7) * 0.3,
            Math.sin(f.angle) * r * 0.5,
          );
          f.mesh.rotation.x += delta * 5;
          f.mesh.rotation.y += delta * 7;
          const pulse = 1 + Math.sin(ms.time * 15) * 0.2;
          f.mesh.scale.setScalar(f.size * pulse);
        });
        ms.shockwaveScale += delta * 12;
        ms.shockwaveOpacity = Math.max(0, 1 - progress);
        if (ms.phaseTime > 0.4) {
          ms.phase = 'orbit';
          ms.phaseTime = 0;
        }
      } else if (ms.phase === 'orbit') {
        ms.hueShift += delta * 1.5;
        const orbitProgress = clamp(ms.phaseTime / 2.0, 0, 1);
        ms.fragments.forEach((f, i) => {
          f.angle += delta * f.speed * (1 - orbitProgress * 0.5);
          const r = f.radius * (1.5 - orbitProgress * 0.8);
          f.mesh.position.set(
            Math.cos(f.angle) * r,
            f.yOffset * (1 - orbitProgress * 0.5) + Math.sin(t * 3 + i) * 0.2,
            Math.sin(f.angle) * r * 0.6,
          );
          f.mesh.rotation.x += delta * 3 * (1 - orbitProgress * 0.5);
          f.mesh.rotation.y += delta * 4 * (1 - orbitProgress * 0.5);

          const hue = ((i / ms.fragments.length) + ms.hueShift) % 1;
          f.material.color.setHSL(hue, 0.85, 0.55);
          f.material.emissive.setHSL(hue, 0.9, 0.3);
          f.material.emissiveIntensity = 0.5 + Math.sin(t * 6 + i * 0.5) * 0.3;

          const scale = f.size * (1 + Math.sin(t * 8 + i) * 0.15);
          f.mesh.scale.setScalar(scale);
        });

        if (ms.phaseTime > 0.5 && ms.phaseTime < 1.8) {
          const pulseInterval = 0.35;
          const newPulseCount = Math.floor((ms.phaseTime - 0.5) / pulseInterval);
          if (newPulseCount > ms.pulseCount) {
            ms.pulseCount = newPulseCount;
            spawnBurst(6);
            burstGlowRef.current += 0.3;
          }
        }

        ms.shockwaveOpacity = 0;
        if (ms.phaseTime > 2.0) {
          ms.phase = 'reform';
          ms.phaseTime = 0;
          ms.shockwaveScale = 0.1;
          ms.shockwaveOpacity = 0.8;
        }
      } else if (ms.phase === 'reform') {
        const progress = clamp(ms.phaseTime / 0.8, 0, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        ms.fragments.forEach((f) => {
          f.mesh.position.lerp(new THREE.Vector3(0, 0, 0), ease * 0.15);
          f.mesh.rotation.x += delta * (1 - ease) * 5;
          f.mesh.rotation.y += delta * (1 - ease) * 5;
          const scale = f.size * (1 - ease * 0.7);
          f.mesh.scale.setScalar(Math.max(0.01, scale));
          f.material.opacity = 1 - ease;
        });

        ms.shockwaveScale += delta * 8;
        ms.shockwaveOpacity = Math.max(0, 0.8 - progress);

        if (progress > 0.5 && !bodyVisibleRef.current) {
          bodyVisibleRef.current = true;
        }

        if (rootRef.current) {
          const bounceBack = 1 + (1 - ease) * 0.5;
          const squishReform = ease < 0.5
            ? 1 + (1 - ease * 2) * 0.3
            : 1 - (ease - 0.5) * 0.1;
          rootRef.current.scale.set(
            squishReform * bounceBack * 0.9,
            (2 - squishReform) * bounceBack * 0.9,
            bounceBack * 0.95,
          );
        }

        if (ms.phaseTime > 0.8) {
          ms.active = false;
          ms.phase = 'none';
          cleanupMegaFragments();
          bodyVisibleRef.current = true;
          targetScaleRef.current.set(1.15, 0.88, 1.05);
          spawnBurst(15);
          burstGlowRef.current += 0.6;

          if (outerRef.current) {
            const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
            const baseColor = hexToColor(slime.color);
            if ('color' in mat) (mat as unknown as { color: THREE.Color }).color.copy(baseColor);
          }

          window.setTimeout(() => {
            if (isDraggingRef.current) return;
            targetScaleRef.current.set(1, 1, 1);
          }, 300);
        }
      }
    }

    if (shockwaveRef.current) {
      const ms = megaStateRef.current;
      shockwaveRef.current.scale.setScalar(ms.shockwaveScale);
      (shockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = ms.shockwaveOpacity;
      shockwaveRef.current.visible = ms.shockwaveOpacity > 0.01;
    }

    // --- Deformation ---
    deformFrameRef.current += 1;
    if (deformFrameRef.current % preset.deformEvery === 0) {
      const displacement = 0.032 + Math.sin(t * 1.7) * 0.01 + burstGlowRef.current * 0.025;
      const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
      const arr = positionAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const bx = basePositions[i];
        const by = basePositions[i + 1];
        const bz = basePositions[i + 2];
        const nx = normals[i];
        const ny = normals[i + 1];
        const nz = normals[i + 2];

        const waveA = Math.sin(t * 2.2 + nx * 4.2 + ny * 5.8 + nz * 3.7) * displacement;
        const waveB = Math.cos(t * 3.1 + nx * 6.5 - ny * 4.1 + nz * 6.8) * displacement * 0.55;
        const waveC = Math.sin(t * 4.3 + nx * 3.1 + ny * 7.2 - nz * 5.4) * displacement * 0.28;
        const radiusScale = 1 + waveA + waveB + waveC;

        arr[i] = bx * radiusScale;
        arr[i + 1] = by * (1 + waveA * 0.85 + waveB * 0.5 + waveC * 0.3);
        arr[i + 2] = bz * (1 + waveA * 0.9 + waveB * 0.65 + waveC * 0.35);
      }
      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    // --- Blinking ---
    blinkTimerRef.current += delta;
    if (blinkTimerRef.current > 3 + Math.sin(t * 0.3) * 1.5) {
      blinkRef.current = 1;
      blinkTimerRef.current = 0;
    }
    if (blinkRef.current > 0) {
      blinkRef.current = Math.max(0, blinkRef.current - delta * 6);
    }
    const blinkScale = 1 - blinkRef.current * 0.85;

    // --- Eye tracking ---
    const eyeLookX = clamp(pointer.x * 0.07, -0.06, 0.06);
    const eyeLookY = clamp(pointer.y * 0.05, -0.04, 0.04);

    if (leftEyeGroupRef.current) {
      leftEyeGroupRef.current.scale.y = blinkScale;
    }
    if (rightEyeGroupRef.current) {
      rightEyeGroupRef.current.scale.y = blinkScale;
    }

    if (leftIrisRef.current) {
      leftIrisRef.current.position.set(eyeLookX * 0.7, eyeLookY * 0.7, 0.045);
    }
    if (rightIrisRef.current) {
      rightIrisRef.current.position.set(eyeLookX * 0.7, eyeLookY * 0.7, 0.045);
    }
    if (leftPupilRef.current) {
      leftPupilRef.current.position.set(eyeLookX, eyeLookY, 0.07);
    }
    if (rightPupilRef.current) {
      rightPupilRef.current.position.set(eyeLookX, eyeLookY, 0.07);
    }

    if (mouthRef.current) {
      mouthRef.current.scale.set(1 + burstGlowRef.current * 0.55, 1 + burstGlowRef.current * 0.25, 1);
      mouthRef.current.rotation.z = Math.sin(t * 1.7) * 0.1;
    }

    if (sparkleRef.current) {
      sparkleRef.current.rotation.y += delta * 0.36;
      sparkleRef.current.children.forEach((child, index) => {
        child.position.y += Math.sin(t * 1.8 + index * 1.7) * 0.0009;
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.42 + Math.sin(t * 2.4 + index) * 0.2 + burstGlowRef.current * 0.4;
      });
    }

    // --- Burst particles ---
    for (let i = burstParticlesRef.current.length - 1; i >= 0; i -= 1) {
      const particle = burstParticlesRef.current[i];
      particle.life += delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta * 2.1);
      particle.velocity.y -= delta * 0.9;
      const lifeRatio = clamp(particle.life / particle.ttl, 0, 1);
      particle.material.opacity = 1 - lifeRatio;
      const scale = 0.72 + lifeRatio * 1.2;
      particle.mesh.scale.setScalar(scale);
      if (lifeRatio >= 1) {
        particle.mesh.removeFromParent();
        particle.material.dispose();
        burstParticlesRef.current.splice(i, 1);
      }
    }

    // --- Fragment reformation ---
    for (let i = fragmentsRef.current.length - 1; i >= 0; i--) {
      const frag = fragmentsRef.current[i];
      frag.life += delta;

      if (frag.life < 1.2) {
        frag.mesh.position.addScaledVector(frag.velocity, delta);
        frag.velocity.y -= delta * 2.5;
        frag.velocity.multiplyScalar(0.98);
        frag.mesh.rotation.x += frag.angularVelocity.x * delta;
        frag.mesh.rotation.y += frag.angularVelocity.y * delta;
        frag.mesh.rotation.z += frag.angularVelocity.z * delta;
      } else {
        if (!frag.reforming) frag.reforming = true;
        const reformSpeed = 0.035 * d;
        frag.mesh.position.lerp(new THREE.Vector3(0, -0.02, 0), reformSpeed);
        frag.mesh.rotation.x *= 0.96;
        frag.mesh.rotation.y *= 0.96;
        frag.mesh.rotation.z *= 0.96;

        const dist = frag.mesh.position.length();
        if (dist < 0.15) {
          frag.material.opacity = clamp(frag.material.opacity - delta * 1.5, 0, 1);
          const shrink = Math.max(0.01, frag.scale * (frag.material.opacity));
          frag.mesh.scale.setScalar(shrink);
        }

        if (frag.material.opacity <= 0.02) {
          frag.mesh.removeFromParent();
          frag.material.dispose();
          fragmentsRef.current.splice(i, 1);
          if (fragmentsRef.current.length === 0) {
            bodyVisibleRef.current = true;
          }
        }
      }

      if (frag.life > 0.3 && frag.life < 1.2) {
        const wobble = Math.sin(frag.life * 8 + i) * 0.1;
        frag.mesh.scale.setScalar(frag.scale * (1 + wobble));
      }
    }

    // --- Body visibility during fragment mode ---
    if (outerRef.current) {
      const targetOpacity = bodyVisibleRef.current ? 1 : 0;
      const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
      if ('opacity' in mat) {
        mat.opacity = THREE.MathUtils.lerp(mat.opacity ?? 1, targetOpacity, 0.15 * d);
      }
      outerRef.current.visible = mat.opacity > 0.01;
    }
    if (innerRef.current) {
      innerRef.current.visible = bodyVisibleRef.current;
    }
    if (rimRef.current) {
      const material = rimRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = bodyVisibleRef.current
        ? clamp(0.14 + burstGlowRef.current * 0.28, 0.14, 0.42)
        : 0;
    }

    if (outerRef.current && bodyVisibleRef.current) {
      const material = outerRef.current.material as THREE.MeshPhysicalMaterial;
      material.clearcoat = clamp(0.8 + burstGlowRef.current * 0.65, 0.8, 1);
      material.sheen = clamp(0.42 + burstGlowRef.current * 0.5, 0.42, 0.95);
      material.sheenRoughness = clamp(0.38 - burstGlowRef.current * 0.2, 0.16, 0.38);
    }

    burstGlowRef.current = Math.max(0, burstGlowRef.current - delta * 1.8);
  });

  const baseColor = hexToColor(slime.color);
  const innerColor = darken(slime.color, 0.28);
  const rimColor = lighten(slime.color, 0.7);

  return (
    <>
      <color attach="background" args={['#000000']} />

      <ambientLight intensity={0.62} />
      <directionalLight position={[2.6, 2.2, 2.5]} intensity={1.15} color="#f4f8ff" />
      <directionalLight position={[-2.2, -1.5, 1.7]} intensity={0.45} color="#9bc8ff" />
      <pointLight position={[0, 1.7, 2.4]} intensity={1.1} color="#ffd6f8" />

      <mesh position={[0, -1.5, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.52, 64]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.2} />
      </mesh>

      {/* Shockwave ring for mega morph */}
      <mesh ref={shockwaveRef} position={[0, 0, 0.5]} rotation={[0, 0, 0]} visible={false}>
        <ringGeometry args={[0.8, 1, 64]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <group ref={megaLayerRef} />

      <group
        ref={rootRef}
        position={[0, -0.02, 0]}
        onPointerDown={(event) => {
          event.stopPropagation();
          isDraggingRef.current = true;
          spawnBurst(4);
          onInteract?.('drag');
        }}
      >
        <group ref={particleLayerRef} />
        <group ref={fragmentLayerRef} />

        <mesh ref={rimRef} geometry={rimGeometry}>
          <meshBasicMaterial
            color={rimColor}
            transparent
            opacity={0.14}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>

        <mesh ref={outerRef} geometry={geometry}>
          <MeshTransmissionMaterial
            backside
            thickness={1.2}
            roughness={preset.roughness}
            samples={preset.transmissionSamples}
            chromaticAberration={preset.chromaticAberration}
            anisotropicBlur={preset.anisotropicBlur}
            distortion={preset.distortion}
            distortionScale={preset.distortionScale}
            temporalDistortion={preset.temporalDistortion}
            clearcoat={1}
            clearcoatRoughness={0.12}
            ior={1.17}
            color={baseColor}
            attenuationColor={baseColor}
            attenuationDistance={0.9}
          />
        </mesh>

        <mesh ref={innerRef} geometry={innerGeometry} position={[0, 0.05, -0.04]}>
          <meshPhysicalMaterial
            color={innerColor}
            transparent
            opacity={0.3}
            roughness={0.28}
            metalness={0.04}
            clearcoat={0.5}
            clearcoatRoughness={0.25}
          />
        </mesh>

        <group ref={sparkleRef}>
          {sparklePoints.map((point, index) => (
            <mesh key={index} position={point}>
              <sphereGeometry args={[0.05, preset.sparkleSegments, preset.sparkleSegments]} />
              <meshStandardMaterial
                color={sparkle?.color ?? '#dfe6e9'}
                emissive={sparkle?.color ?? '#ffffff'}
                emissiveIntensity={0.5}
                transparent
                opacity={0.8}
                roughness={0.2}
                metalness={0.1}
              />
            </mesh>
          ))}
        </group>

        {charmTexture && (
          <sprite position={[0.63, 0.63, 0.28]} scale={[0.5, 0.5, 0.5]}>
            <spriteMaterial map={charmTexture} transparent depthWrite={false} />
          </sprite>
        )}

        {/* Left Eye */}
        <group ref={leftEyeGroupRef} position={[-0.33, 0.16, 0.88]}>
          {/* Sclera with subtle shading */}
          <mesh>
            <sphereGeometry args={[0.15, 32, 32]} />
            <meshPhysicalMaterial
              color="#fdfdfd"
              roughness={0.08}
              metalness={0}
              clearcoat={0.9}
              clearcoatRoughness={0.05}
              sheen={0.2}
              sheenRoughness={0.3}
              sheenColor={new THREE.Color('#ffe0e0')}
            />
          </mesh>
          {/* Slight shadow on top of sclera (eyelid effect) */}
          <mesh position={[0, 0.04, 0.06]} rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.1, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
            <meshBasicMaterial color="#00000015" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          {/* Iris */}
          <mesh ref={leftIrisRef} position={[0, 0, 0.045]}>
            <circleGeometry args={[0.085, 32]} />
            <meshPhysicalMaterial
              color={irisColor}
              roughness={0.15}
              metalness={0.05}
              clearcoat={0.7}
              emissive={irisColor}
              emissiveIntensity={0.15}
            />
          </mesh>
          {/* Pupil */}
          <mesh ref={leftPupilRef} position={[0, 0, 0.07]}>
            <circleGeometry args={[0.045, 24]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.3} />
          </mesh>
          {/* Specular highlight (top-left) */}
          <mesh position={[-0.03, 0.04, 0.12]}>
            <circleGeometry args={[0.025, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} depthWrite={false} />
          </mesh>
          {/* Secondary highlight (bottom-right, smaller) */}
          <mesh position={[0.02, -0.02, 0.11]}>
            <circleGeometry args={[0.012, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>

        {/* Right Eye */}
        <group ref={rightEyeGroupRef} position={[0.33, 0.16, 0.88]}>
          {/* Sclera */}
          <mesh>
            <sphereGeometry args={[0.15, 32, 32]} />
            <meshPhysicalMaterial
              color="#fdfdfd"
              roughness={0.08}
              metalness={0}
              clearcoat={0.9}
              clearcoatRoughness={0.05}
              sheen={0.2}
              sheenRoughness={0.3}
              sheenColor={new THREE.Color('#ffe0e0')}
            />
          </mesh>
          {/* Eyelid shadow */}
          <mesh position={[0, 0.04, 0.06]} rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.1, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.35]} />
            <meshBasicMaterial color="#00000015" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          {/* Iris */}
          <mesh ref={rightIrisRef} position={[0, 0, 0.045]}>
            <circleGeometry args={[0.085, 32]} />
            <meshPhysicalMaterial
              color={irisColor}
              roughness={0.15}
              metalness={0.05}
              clearcoat={0.7}
              emissive={irisColor}
              emissiveIntensity={0.15}
            />
          </mesh>
          {/* Pupil */}
          <mesh ref={rightPupilRef} position={[0, 0, 0.07]}>
            <circleGeometry args={[0.045, 24]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.3} />
          </mesh>
          {/* Specular highlight */}
          <mesh position={[-0.03, 0.04, 0.12]}>
            <circleGeometry args={[0.025, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} depthWrite={false} />
          </mesh>
          {/* Secondary highlight */}
          <mesh position={[0.02, -0.02, 0.11]}>
            <circleGeometry args={[0.012, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>

        <mesh ref={mouthRef} position={[0, -0.28, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.03, 16, 48, Math.PI]} />
          <meshStandardMaterial color="#2d3436" roughness={0.45} />
        </mesh>
      </group>
    </>
  );
};

export const PixiSlimeStage = forwardRef<PixiSlimeStageHandle, PixiSlimeStageProps>(
  function PixiSlimeStage({ slime, onInteract }, ref) {
    const controlsRef = useRef<StageControls | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        poke: () => controlsRef.current?.poke(),
        squish: () => controlsRef.current?.squish(),
        stretch: () => controlsRef.current?.stretch(),
        bounce: () => controlsRef.current?.bounce(),
        megaMorph: () => controlsRef.current?.megaMorph(),
        burst: (count?: number) => controlsRef.current?.burst(count),
      }),
      [],
    );

    if (!slime) return <div className="pixi-host" />;

    return (
      <div className="pixi-host">
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          }}
          dpr={ULTRA_PRESET.dpr}
          camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0.12, 4.1] }}
          style={{ background: 'transparent' }}
        >
          <SlimeScene
            slime={slime}
            onInteract={onInteract}
            onReady={(controls) => {
              controlsRef.current = controls;
            }}
          />
        </Canvas>
      </div>
    );
  },
);
