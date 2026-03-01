import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { findCharm, findSparkle } from '../gameData';
import type { Slime } from '../types';

type InteractionKind = 'drag' | 'poke' | 'squish' | 'stretch' | 'bounce' | 'mega';
export type RenderQuality = 'ultra' | 'balanced' | 'battery';

interface QualityPreset {
  dpr: [number, number];
  geometrySegments: number;
  innerSegments: number;
  rimSegments: number;
  sparkleCount: number;
  sparkleSegments: number;
  burstScale: number;
  burstCap: number;
  deformEvery: number;
  distortion: number;
  distortionScale: number;
  temporalDistortion: number;
  chromaticAberration: number;
  anisotropicBlur: number;
  roughness: number;
  transmissionSamples: number;
}

const QUALITY_PRESETS: Record<RenderQuality, QualityPreset> = {
  ultra: {
    dpr: [1, 2],
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
  },
  balanced: {
    dpr: [1, 1.75],
    geometrySegments: 64,
    innerSegments: 44,
    rimSegments: 32,
    sparkleCount: 12,
    sparkleSegments: 10,
    burstScale: 0.75,
    burstCap: 22,
    deformEvery: 1,
    distortion: 0.1,
    distortionScale: 0.24,
    temporalDistortion: 0.12,
    chromaticAberration: 0.02,
    anisotropicBlur: 0.06,
    roughness: 0.08,
    transmissionSamples: 3,
  },
  battery: {
    dpr: [1, 1.25],
    geometrySegments: 42,
    innerSegments: 28,
    rimSegments: 20,
    sparkleCount: 8,
    sparkleSegments: 8,
    burstScale: 0.5,
    burstCap: 14,
    deformEvery: 2,
    distortion: 0.06,
    distortionScale: 0.14,
    temporalDistortion: 0.07,
    chromaticAberration: 0.01,
    anisotropicBlur: 0.03,
    roughness: 0.12,
    transmissionSamples: 2,
  },
};

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
  quality: RenderQuality;
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

const SlimeScene = ({
  slime,
  onInteract,
  onReady,
  quality,
}: {
  slime: Slime;
  onInteract?: (kind: InteractionKind) => void;
  onReady: (controls: StageControls | null) => void;
  quality: RenderQuality;
}) => {
  const { pointer, camera, scene } = useThree();
  const preset = QUALITY_PRESETS[quality];

  const rootRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const leftPupilRef = useRef<THREE.Mesh>(null);
  const rightPupilRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const sparkleRef = useRef<THREE.Group>(null);
  const particleLayerRef = useRef<THREE.Group>(null);

  const burstParticlesRef = useRef<BurstParticle[]>([]);
  const isDraggingRef = useRef(false);
  const targetPosRef = useRef(new THREE.Vector3(0, -0.02, 0));
  const currentPosRef = useRef(new THREE.Vector3(0, -0.02, 0));
  const targetScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const currentScaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const burstGlowRef = useRef(0);
  const deformFrameRef = useRef(0);

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
      poke: () => impulse('poke', 0.84, 1.15, 0.2),
      squish: () => impulse('squish', 1.35, 0.68, 0.35),
      stretch: () => impulse('stretch', 0.72, 1.3, 0.3),
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
      geometry.dispose();
      innerGeometry.dispose();
      rimGeometry.dispose();
      burstGeometry.dispose();
      if (charmTexture) charmTexture.dispose();
    };
  }, [burstGeometry, charmTexture, geometry, innerGeometry, rimGeometry]);

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

  const impulse = (kind: InteractionKind, sx: number, sy: number, burst: number): void => {
    targetScaleRef.current.set(sx, sy, clamp((sx + sy) * 0.5, 0.76, 1.2));
    spawnBurst(6);
    burstGlowRef.current += burst;
    onInteract?.(kind);
    window.setTimeout(() => {
      if (isDraggingRef.current) return;
      targetScaleRef.current.set(1, 1, 1);
    }, 220);
  };

  const bounce = (): void => {
    targetPosRef.current.set(0, 0.55, 0);
    targetScaleRef.current.set(0.88, 1.2, 0.96);
    spawnBurst(8);
    burstGlowRef.current += 0.28;
    onInteract?.('bounce');
    window.setTimeout(() => {
      targetPosRef.current.set(0, -0.02, 0);
      targetScaleRef.current.set(1.16, 0.84, 1.1);
      window.setTimeout(() => {
        if (isDraggingRef.current) return;
        targetScaleRef.current.set(1, 1, 1);
      }, 140);
    }, 180);
  };

  const mega = (): void => {
    targetScaleRef.current.set(1.42, 0.63, 1.2);
    spawnBurst(18);
    burstGlowRef.current += 0.75;
    onInteract?.('mega');
    window.setTimeout(() => {
      if (isDraggingRef.current) return;
      targetScaleRef.current.set(1, 1, 1);
    }, 280);
  };

  useFrame((state, delta) => {
    const d = clamp(delta * 60, 0, 2.4);
    const t = state.clock.elapsedTime;

    if (isDraggingRef.current) {
      targetPosRef.current.set(pointer.x * 1.24, pointer.y * 0.82 - 0.02, 0);
      const dist = Math.min(1, Math.hypot(pointer.x, pointer.y));
      const stretch = 1 + dist * 0.38;
      const squish = 1 - dist * 0.24;
      if (Math.abs(pointer.x) > Math.abs(pointer.y)) {
        targetScaleRef.current.set(stretch, squish, 1);
      } else {
        targetScaleRef.current.set(squish, stretch, 1);
      }
    }

    currentPosRef.current.lerp(targetPosRef.current, 0.16 * d);
    currentScaleRef.current.lerp(targetScaleRef.current, 0.18 * d);

    const breathe = 1 + Math.sin(t * 1.8) * 0.018;
    if (rootRef.current) {
      rootRef.current.position.copy(currentPosRef.current);
      rootRef.current.scale.set(
        currentScaleRef.current.x * breathe,
        currentScaleRef.current.y / breathe,
        currentScaleRef.current.z,
      );
      rootRef.current.rotation.z = Math.sin(t * 1.2) * 0.05;
      rootRef.current.rotation.x = Math.sin(t * 0.95) * 0.04;
    }

    deformFrameRef.current += 1;
    if (deformFrameRef.current % preset.deformEvery === 0) {
      const displacement = 0.022 + Math.sin(t * 1.7) * 0.006 + burstGlowRef.current * 0.018;
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
        const waveB = Math.cos(t * 3.1 + nx * 6.5 - ny * 4.1 + nz * 6.8) * displacement * 0.42;
        const radiusScale = 1 + waveA + waveB;

        arr[i] = bx * radiusScale;
        arr[i + 1] = by * (1 + waveA * 0.75 + waveB * 0.42);
        arr[i + 2] = bz * (1 + waveA * 0.8 + waveB * 0.56);
      }
      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    const eyeLookX = clamp(pointer.x * 0.05, -0.045, 0.045);
    const eyeLookY = clamp(pointer.y * 0.03, -0.03, 0.03);
    if (leftPupilRef.current) leftPupilRef.current.position.set(-0.33 + eyeLookX, 0.14 + eyeLookY, 0.95);
    if (rightPupilRef.current) rightPupilRef.current.position.set(0.33 + eyeLookX, 0.14 + eyeLookY, 0.95);

    if (mouthRef.current) {
      mouthRef.current.scale.set(1 + burstGlowRef.current * 0.45, 1 + burstGlowRef.current * 0.2, 1);
      mouthRef.current.rotation.z = Math.sin(t * 1.7) * 0.08;
    }

    if (sparkleRef.current) {
      sparkleRef.current.rotation.y += delta * (quality === 'ultra' ? 0.36 : quality === 'balanced' ? 0.24 : 0.16);
      sparkleRef.current.children.forEach((child, index) => {
        child.position.y += Math.sin(t * 1.8 + index * 1.7) * 0.0009;
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.42 + Math.sin(t * 2.4 + index) * 0.2 + burstGlowRef.current * 0.4;
      });
    }

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

    if (outerRef.current) {
      const material = outerRef.current.material as THREE.MeshPhysicalMaterial;
      material.clearcoat = clamp(0.8 + burstGlowRef.current * 0.65, 0.8, 1);
      material.sheen = clamp(0.42 + burstGlowRef.current * 0.5, 0.42, 0.95);
      material.sheenRoughness = clamp(0.38 - burstGlowRef.current * 0.2, 0.16, 0.38);
    }
    if (rimRef.current) {
      const material = rimRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = clamp(0.14 + burstGlowRef.current * 0.28, 0.14, 0.42);
    }
    burstGlowRef.current = Math.max(0, burstGlowRef.current - delta * 1.8);
  });

  const baseColor = hexToColor(slime.color);
  const innerColor = darken(slime.color, 0.28);
  const rimColor = lighten(slime.color, 0.7);

  return (
    <>
      <color attach="background" args={['#000000']} />

      <ambientLight intensity={quality === 'ultra' ? 0.62 : quality === 'balanced' ? 0.56 : 0.5} />
      <directionalLight
        position={[2.6, 2.2, 2.5]}
        intensity={quality === 'ultra' ? 1.15 : quality === 'balanced' ? 0.92 : 0.75}
        color="#f4f8ff"
      />
      <directionalLight
        position={[-2.2, -1.5, 1.7]}
        intensity={quality === 'ultra' ? 0.45 : quality === 'balanced' ? 0.3 : 0.22}
        color="#9bc8ff"
      />
      <pointLight
        position={[0, 1.7, 2.4]}
        intensity={quality === 'ultra' ? 1.1 : quality === 'balanced' ? 0.82 : 0.62}
        color="#ffd6f8"
      />

      <mesh position={[0, -1.5, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.52, 64]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.2} />
      </mesh>

      <group
        ref={rootRef}
        position={[0, -0.02, 0]}
        onPointerDown={(event) => {
          event.stopPropagation();
          isDraggingRef.current = true;
          spawnBurst(3);
          onInteract?.('drag');
        }}
      >
        <group ref={particleLayerRef} />

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
          {quality === 'battery' ? (
            <meshPhysicalMaterial
              transmission={0.86}
              thickness={0.95}
              roughness={0.12}
              clearcoat={0.9}
              clearcoatRoughness={0.2}
              ior={1.16}
              transparent
              opacity={0.95}
              color={baseColor}
              attenuationColor={baseColor}
              attenuationDistance={1.1}
            />
          ) : (
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
          )}
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
                emissiveIntensity={quality === 'ultra' ? 0.5 : quality === 'balanced' ? 0.42 : 0.34}
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

        <mesh position={[-0.33, 0.16, 0.9]}>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0} />
        </mesh>
        <mesh position={[0.33, 0.16, 0.9]}>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0} />
        </mesh>
        <mesh ref={leftPupilRef} position={[-0.33, 0.14, 0.95]}>
          <sphereGeometry args={[0.058, 20, 20]} />
          <meshStandardMaterial color="#2d3436" roughness={0.42} />
        </mesh>
        <mesh ref={rightPupilRef} position={[0.33, 0.14, 0.95]}>
          <sphereGeometry args={[0.058, 20, 20]} />
          <meshStandardMaterial color="#2d3436" roughness={0.42} />
        </mesh>

        <mesh ref={mouthRef} position={[0, -0.28, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.03, 16, 48, Math.PI]} />
          <meshStandardMaterial color="#2d3436" roughness={0.45} />
        </mesh>
      </group>
    </>
  );
};

export const PixiSlimeStage = forwardRef<PixiSlimeStageHandle, PixiSlimeStageProps>(
  function PixiSlimeStage({ slime, onInteract, quality }, ref) {
    const controlsRef = useRef<StageControls | null>(null);
    const preset = QUALITY_PRESETS[quality];

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
            antialias: quality !== 'battery',
            alpha: true,
            powerPreference: quality === 'battery' ? 'low-power' : 'high-performance',
          }}
          dpr={preset.dpr}
          camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0.12, 4.1] }}
          style={{ background: 'transparent' }}
        >
          <SlimeScene
            slime={slime}
            onInteract={onInteract}
            quality={quality}
            onReady={(controls) => {
              controlsRef.current = controls;
            }}
          />
        </Canvas>
      </div>
    );
  },
);
