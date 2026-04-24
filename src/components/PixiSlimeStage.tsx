import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { findCharm, findClothing, findSparkle } from '../gameData';
import type { EyeStyleId, Slime } from '../types';

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
  eyeStyle?: EyeStyleId;
  clothing?: string;
  slimeLevel?: number;
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

interface PinchState {
  active: boolean;
  startDist: number;
  currentDist: number;
  centerX: number;
  centerY: number;
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
  distortion: 0.18,
  distortionScale: 0.42,
  temporalDistortion: 0.22,
  chromaticAberration: 0.035,
  anisotropicBlur: 0.1,
  roughness: 0.04,
  transmissionSamples: 6,
};

// Gaussian falloff for localized stretch: 1/(2*r²) where r≈0.65
const PULL_FALLOFF = 1 / (2 * 0.65 * 0.65);

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

// ---- Eye rendering by style ----

function NormalEye({
  groupRef,
  irisRef,
  pupilRef,
  irisColor,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
  irisRef: React.RefObject<THREE.Mesh | null>;
  pupilRef: React.RefObject<THREE.Mesh | null>;
  irisColor: THREE.Color;
}) {
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.15, 32, 32]} />
        <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} clearcoatRoughness={0.05} sheen={0.2} sheenRoughness={0.3} sheenColor={new THREE.Color('#ffe0e0')} />
      </mesh>
      <mesh ref={irisRef} position={[0, 0, 0.08]}>
        <sphereGeometry args={[0.088, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshPhysicalMaterial color={irisColor} roughness={0.12} metalness={0.08} clearcoat={0.8} emissive={irisColor} emissiveIntensity={0.12} />
      </mesh>
      <mesh ref={pupilRef} position={[0, 0, 0.11]}>
        <sphereGeometry args={[0.052, 24, 24]} />
        <meshStandardMaterial color="#050505" roughness={0.2} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <sphereGeometry args={[0.14, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.45]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.06} roughness={0} clearcoat={1} clearcoatRoughness={0} depthWrite={false} />
      </mesh>
      <mesh position={[-0.035, 0.045, 0.14]}>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh position={[0.025, -0.02, 0.13]}>
        <sphereGeometry args={[0.011, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

function GooglyEye({
  groupRef,
  pupilRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
  pupilRef: React.RefObject<THREE.Mesh | null>;
}) {
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.05} clearcoat={1} clearcoatRoughness={0.02} />
      </mesh>
      <mesh ref={pupilRef} position={[0, 0, 0.12]}>
        <sphereGeometry args={[0.09, 24, 24]} />
        <meshStandardMaterial color="#111111" roughness={0.15} />
      </mesh>
      <mesh position={[-0.04, 0.06, 0.16]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} />
      </mesh>
    </group>
  );
}

function HeartEye({
  groupRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const heartShape = useMemo(() => {
    const shape = new THREE.Shape();
    const s = 0.12;
    shape.moveTo(0, s * -0.5);
    shape.bezierCurveTo(s * 0.4, s * -1.2, s * 1.4, s * -0.6, 0, s * 0.6);
    shape.moveTo(0, s * -0.5);
    shape.bezierCurveTo(s * -0.4, s * -1.2, s * -1.4, s * -0.6, 0, s * 0.6);
    return shape;
  }, []);

  return (
    <group ref={groupRef}>
      <mesh rotation={[0, 0, Math.PI]}>
        <shapeGeometry args={[heartShape]} />
        <meshStandardMaterial color="#ff3366" emissive="#ff1144" emissiveIntensity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.02, 0.03, 0.02]}>
        <sphereGeometry args={[0.015, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function SleepyEye({
  groupRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} />
      </mesh>
      <mesh position={[0, 0.02, 0.1]}>
        <sphereGeometry args={[0.06, 20, 20]} />
        <meshStandardMaterial color="#222222" roughness={0.3} />
      </mesh>
      {/* Heavy eyelid covering top half */}
      <mesh position={[0, 0.06, 0.08]} scale={[1.1, 0.7, 1]}>
        <sphereGeometry args={[0.12, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color="#ddb892" roughness={0.3} />
      </mesh>
      <mesh position={[-0.03, 0.04, 0.13]}>
        <sphereGeometry args={[0.015, 10, 10]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}

function AngryEye({
  groupRef,
  irisRef,
  pupilRef,
  irisColor,
  side,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
  irisRef: React.RefObject<THREE.Mesh | null>;
  pupilRef: React.RefObject<THREE.Mesh | null>;
  irisColor: THREE.Color;
  side: 'left' | 'right';
}) {
  const browAngle = side === 'left' ? -0.4 : 0.4;
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} />
      </mesh>
      <mesh ref={irisRef} position={[0, -0.01, 0.08]}>
        <sphereGeometry args={[0.08, 28, 28, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshPhysicalMaterial color={irisColor} roughness={0.12} clearcoat={0.7} emissive={irisColor} emissiveIntensity={0.15} />
      </mesh>
      <mesh ref={pupilRef} position={[0, -0.01, 0.1]}>
        <sphereGeometry args={[0.04, 20, 20]} />
        <meshStandardMaterial color="#050505" roughness={0.2} />
      </mesh>
      {/* Angry brow */}
      <mesh position={[0, 0.1, 0.1]} rotation={[0, 0, browAngle]}>
        <boxGeometry args={[0.22, 0.04, 0.03]} />
        <meshStandardMaterial color="#3d2c2c" roughness={0.4} />
      </mesh>
      <mesh position={[-0.03, 0.04, 0.13]}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function XEye({
  groupRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshPhysicalMaterial color="#f0f0f0" roughness={0.1} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.16, 0.03, 0.02]} />
        <meshStandardMaterial color="#333333" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.16, 0.03, 0.02]} />
        <meshStandardMaterial color="#333333" roughness={0.3} />
      </mesh>
    </group>
  );
}

function StarEye({
  groupRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerR = 0.11;
    const innerR = 0.045;
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }, []);

  return (
    <group ref={groupRef}>
      <mesh>
        <shapeGeometry args={[starShape]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffaa00" emissiveIntensity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.02, 0.03, 0.02]}>
        <sphereGeometry args={[0.018, 10, 10]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function DizzyEye({
  groupRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.06, 0.015, 12, 32]} />
        <meshStandardMaterial color="#6c5ce7" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.035, 0.012, 10, 24]} />
        <meshStandardMaterial color="#a29bfe" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.12]}>
        <sphereGeometry args={[0.015, 10, 10]} />
        <meshStandardMaterial color="#222222" roughness={0.3} />
      </mesh>
    </group>
  );
}

function renderEyePair(
  eyeStyle: EyeStyleId,
  refs: {
    leftGroupRef: React.RefObject<THREE.Group | null>;
    rightGroupRef: React.RefObject<THREE.Group | null>;
    leftIrisRef: React.RefObject<THREE.Mesh | null>;
    rightIrisRef: React.RefObject<THREE.Mesh | null>;
    leftPupilRef: React.RefObject<THREE.Mesh | null>;
    rightPupilRef: React.RefObject<THREE.Mesh | null>;
  },
  irisColor: THREE.Color,
) {
  const { leftGroupRef, rightGroupRef, leftIrisRef, rightIrisRef, leftPupilRef, rightPupilRef } = refs;

  switch (eyeStyle) {
    case 'googly':
      return (
        <>
          <group position={[-0.33, 0.18, 0.85]}>
            <GooglyEye groupRef={leftGroupRef} pupilRef={leftPupilRef} />
          </group>
          <group position={[0.33, 0.18, 0.85]}>
            <GooglyEye groupRef={rightGroupRef} pupilRef={rightPupilRef} />
          </group>
        </>
      );
    case 'cyclops':
      return (
        <group position={[0, 0.16, 0.88]}>
          <group ref={leftGroupRef}>
            <mesh>
              <sphereGeometry args={[0.22, 32, 32]} />
              <meshPhysicalMaterial color="#fdfdfd" roughness={0.06} clearcoat={1} clearcoatRoughness={0.02} />
            </mesh>
            <mesh ref={leftIrisRef} position={[0, 0, 0.12]}>
              <sphereGeometry args={[0.12, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
              <meshPhysicalMaterial color={irisColor} roughness={0.1} clearcoat={0.9} emissive={irisColor} emissiveIntensity={0.15} />
            </mesh>
            <mesh ref={leftPupilRef} position={[0, 0, 0.15]}>
              <sphereGeometry args={[0.065, 24, 24]} />
              <meshStandardMaterial color="#050505" roughness={0.2} />
            </mesh>
            <mesh position={[-0.05, 0.07, 0.2]}>
              <sphereGeometry args={[0.03, 14, 14]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} />
            </mesh>
          </group>
          <group ref={rightGroupRef} visible={false} />
        </group>
      );
    case 'alien':
      return (
        <>
          <group position={[-0.38, 0.22, 0.82]} rotation={[0, 0, 0.15]}>
            <NormalEye groupRef={leftGroupRef} irisRef={leftIrisRef} pupilRef={leftPupilRef} irisColor={new THREE.Color('#00ff88')} />
          </group>
          <group position={[0, 0.3, 0.86]}>
            <group ref={rightGroupRef}>
              <mesh>
                <sphereGeometry args={[0.1, 24, 24]} />
                <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} />
              </mesh>
              <mesh ref={rightIrisRef} position={[0, 0, 0.05]}>
                <sphereGeometry args={[0.06, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
                <meshPhysicalMaterial color={new THREE.Color('#00ff88')} roughness={0.12} clearcoat={0.7} emissive={new THREE.Color('#00ff44')} emissiveIntensity={0.2} />
              </mesh>
              <mesh ref={rightPupilRef} position={[0, 0, 0.07]}>
                <sphereGeometry args={[0.03, 16, 16]} />
                <meshStandardMaterial color="#050505" roughness={0.2} />
              </mesh>
            </group>
          </group>
          <group position={[0.38, 0.22, 0.82]} rotation={[0, 0, -0.15]}>
            <group>
              <mesh>
                <sphereGeometry args={[0.15, 32, 32]} />
                <meshPhysicalMaterial color="#fdfdfd" roughness={0.08} clearcoat={0.9} />
              </mesh>
              <mesh position={[0, 0, 0.08]}>
                <sphereGeometry args={[0.088, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
                <meshPhysicalMaterial color={new THREE.Color('#00ff88')} roughness={0.12} clearcoat={0.7} emissive={new THREE.Color('#00ff44')} emissiveIntensity={0.2} />
              </mesh>
              <mesh position={[0, 0, 0.11]}>
                <sphereGeometry args={[0.052, 24, 24]} />
                <meshStandardMaterial color="#050505" roughness={0.2} />
              </mesh>
              <mesh position={[-0.035, 0.045, 0.14]}>
                <sphereGeometry args={[0.022, 16, 16]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} />
              </mesh>
            </group>
          </group>
        </>
      );
    case 'heart':
      return (
        <>
          <group position={[-0.3, 0.16, 0.92]}>
            <HeartEye groupRef={leftGroupRef} />
          </group>
          <group position={[0.3, 0.16, 0.92]}>
            <HeartEye groupRef={rightGroupRef} />
          </group>
        </>
      );
    case 'sleepy':
      return (
        <>
          <group position={[-0.33, 0.14, 0.88]}>
            <SleepyEye groupRef={leftGroupRef} />
          </group>
          <group position={[0.33, 0.14, 0.88]}>
            <SleepyEye groupRef={rightGroupRef} />
          </group>
        </>
      );
    case 'angry':
      return (
        <>
          <group position={[-0.33, 0.14, 0.88]}>
            <AngryEye groupRef={leftGroupRef} irisRef={leftIrisRef} pupilRef={leftPupilRef} irisColor={irisColor} side="left" />
          </group>
          <group position={[0.33, 0.14, 0.88]}>
            <AngryEye groupRef={rightGroupRef} irisRef={rightIrisRef} pupilRef={rightPupilRef} irisColor={irisColor} side="right" />
          </group>
        </>
      );
    case 'xeyes':
      return (
        <>
          <group position={[-0.33, 0.16, 0.88]}>
            <XEye groupRef={leftGroupRef} />
          </group>
          <group position={[0.33, 0.16, 0.88]}>
            <XEye groupRef={rightGroupRef} />
          </group>
        </>
      );
    case 'star':
      return (
        <>
          <group position={[-0.3, 0.16, 0.92]}>
            <StarEye groupRef={leftGroupRef} />
          </group>
          <group position={[0.3, 0.16, 0.92]}>
            <StarEye groupRef={rightGroupRef} />
          </group>
        </>
      );
    case 'dizzy':
      return (
        <>
          <group position={[-0.33, 0.16, 0.88]}>
            <DizzyEye groupRef={leftGroupRef} />
          </group>
          <group position={[0.33, 0.16, 0.88]}>
            <DizzyEye groupRef={rightGroupRef} />
          </group>
        </>
      );
    default:
      return (
        <>
          <group position={[-0.33, 0.16, 0.88]}>
            <NormalEye groupRef={leftGroupRef} irisRef={leftIrisRef} pupilRef={leftPupilRef} irisColor={irisColor} />
          </group>
          <group position={[0.33, 0.16, 0.88]}>
            <NormalEye groupRef={rightGroupRef} irisRef={rightIrisRef} pupilRef={rightPupilRef} irisColor={irisColor} />
          </group>
        </>
      );
  }
}

// ---- Clothing rendering ----

// Base positions for each clothing slot — z pushed in front of sphere surface
const CLOTHING_BASE: Record<string, [number, number, number]> = {
  hat:  [0,  0.95, 0.45],
  face: [0,  0.12, 1.10],
  neck: [0, -0.42, 1.02],
  body: [0, -0.15, 1.10],
};
const CLOTHING_SCALE: Record<string, number> = { hat: 0.7, face: 0.6, neck: 0.55, body: 0.8 };

function ClothingRenderer({ clothingId, groupRef }: { clothingId: string; groupRef: React.RefObject<THREE.Group | null> }) {
  const item = findClothing(clothingId);
  if (!item || item.id === 'none') return null;

  const texture = useMemo(() => createEmojiTexture(item.emoji), [item.emoji]);

  useEffect(() => {
    return () => { texture.dispose(); };
  }, [texture]);

  const s = CLOTHING_SCALE[item.slot] ?? 0.6;

  return (
    <group ref={groupRef}>
      <sprite scale={[s, s, s]} renderOrder={10}>
        <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} />
      </sprite>
    </group>
  );
}

// ---- Subsurface-scattering inner-core material ----
// Cheap SSS approximation: wrap lighting + back-translucency lobe + fresnel rim.
// Rendered on an inner "core" mesh that sits behind the transmission shell so
// refraction reads as light scattering through slime.

const SSS_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SSS_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLightDir;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uLightDir);

    float wrap = 0.55;
    float lambert = max(0.0, (dot(N, L) + wrap) / (1.0 + wrap));

    // Translucency: brighten where the view vector points back toward the light
    float back = pow(max(0.0, dot(V, -L) * 0.5 + 0.5), 3.0);
    float trans = back * 0.75;

    float fresnel = pow(1.0 - max(0.0, dot(N, V)), 2.2);

    float pulse = 0.05 * sin(uTime * 1.3);

    vec3 col = uColor * (0.28 + lambert * 0.85);
    col += uColor * (trans + pulse) * 1.3;
    col += vec3(1.0) * fresnel * 0.22;

    float alpha = uOpacity * (0.55 + 0.55 * fresnel + 0.4 * trans);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function SlimeSSSMaterial({ color, opacity = 0.6 }: { color: THREE.Color | string; opacity?: number }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uColor: { value: color instanceof THREE.Color ? color.clone() : new THREE.Color(color) },
    uLightDir: { value: new THREE.Vector3(2.6, 2.2, 2.5).normalize() },
    uOpacity: { value: opacity },
    uTime: { value: 0 },
  }), []);

  useEffect(() => {
    if (color instanceof THREE.Color) {
      uniforms.uColor.value.copy(color);
    } else {
      uniforms.uColor.value.set(color);
    }
    uniforms.uOpacity.value = opacity;
  }, [color, opacity, uniforms]);

  useFrame((_, dt) => {
    if (ref.current) {
      (ref.current.uniforms.uTime.value as number) += dt;
    }
  });

  return (
    <shaderMaterial
      ref={ref}
      transparent
      depthWrite={false}
      uniforms={uniforms}
      vertexShader={SSS_VERTEX}
      fragmentShader={SSS_FRAGMENT}
    />
  );
}

// ---- Main scene ----

const SlimeScene = ({
  slime,
  eyeStyle = 'normal',
  clothing = 'none',
  slimeLevel = 1,
  onInteract,
  onReady,
}: {
  slime: Slime;
  eyeStyle?: EyeStyleId;
  clothing?: string;
  slimeLevel?: number;
  onInteract?: (kind: InteractionKind) => void;
  onReady: (controls: StageControls | null) => void;
}) => {
  const { pointer, camera, scene, gl } = useThree();
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
  const clothingGroupRef = useRef<THREE.Group>(null);
  const clothingBaseRef = useRef(new THREE.Vector3(0, 0, 1));
  const charmGroupRef = useRef<THREE.Group>(null);
  const charmBaseRef = useRef(new THREE.Vector3(0.63, 0.63, 0.55));
  const googlyVelocityRef = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const googlyPosRef = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const pinchRef = useRef<PinchState>({ active: false, startDist: 0, currentDist: 0, centerX: 0, centerY: 0 });

  // Localized stretch state
  const dragHitLocalRef = useRef<THREE.Vector3 | null>(null);
  const dragStartPointerRef = useRef(new THREE.Vector2(0, 0));
  const dragPullRef = useRef(new THREE.Vector3(0, 0, 0));
  const dragVelocityRef = useRef(new THREE.Vector3(0, 0, 0));

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

  const clothingItem = useMemo(() => findClothing(clothing), [clothing]);

  useEffect(() => {
    if (clothingItem && clothingItem.id !== 'none') {
      const base = CLOTHING_BASE[clothingItem.slot];
      if (base) clothingBaseRef.current.set(base[0], base[1], base[2]);
      if (clothingGroupRef.current) clothingGroupRef.current.position.copy(clothingBaseRef.current);
    }
  }, [clothingItem]);

  useEffect(() => {
    if (charmGroupRef.current) charmGroupRef.current.position.copy(charmBaseRef.current);
  }, [charm]);

  useEffect(() => {
    scene.background = null;
    return () => { scene.background = null; };
  }, [scene]);

  // --- Pinch-to-tear touch handling ---
  useEffect(() => {
    const canvas = gl.domElement;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchRef.current = {
          active: true,
          startDist: dist,
          currentDist: dist,
          centerX: (t1.clientX + t2.clientX) / 2,
          centerY: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchRef.current.currentDist = dist;
        pinchRef.current.centerX = (t1.clientX + t2.clientX) / 2;
        pinchRef.current.centerY = (t1.clientY + t2.clientY) / 2;

        const ratio = dist / pinchRef.current.startDist;
        if (ratio > 1.8 && fragmentsRef.current.length === 0 && !megaStateRef.current.active) {
          spawnFragments(8 + Math.floor(Math.random() * 5));
          spawnBurst(12);
          burstGlowRef.current += 0.5;
          onInteract?.('stretch');
          pinchRef.current.active = false;
        } else {
          const stretch = clamp(ratio, 0.5, 2.0);
          targetScaleRef.current.set(stretch, 2 - stretch, 1);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchRef.current.active) {
        pinchRef.current.active = false;
        targetScaleRef.current.set(1, 1, 1);
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, onInteract]);

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
    return () => { onReady(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReady, onInteract]);

  useEffect(() => {
    camera.position.set(0, 0.12, 4.1);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useEffect(() => {
    return () => {
      burstParticlesRef.current.forEach((item) => { item.mesh.removeFromParent(); item.material.dispose(); });
      burstParticlesRef.current = [];
      fragmentsRef.current.forEach((f) => { f.mesh.removeFromParent(); f.material.dispose(); });
      fragmentsRef.current = [];
      cleanupMegaFragments();
      geometry.dispose();
      innerGeometry.dispose();
      rimGeometry.dispose();
      burstGeometry.dispose();
      fragmentGeometry.dispose();
      megaFragGeometry.dispose();
      if (charmTexture) charmTexture.dispose();
    };
  }, [burstGeometry, charmTexture, geometry, innerGeometry, rimGeometry, fragmentGeometry, megaFragGeometry]);

  const cleanupMegaFragments = (): void => {
    const state = megaStateRef.current;
    state.fragments.forEach((f) => { f.mesh.removeFromParent(); f.material.dispose(); });
    state.fragments = [];
  };

  const spawnBurst = (count: number): void => {
    if (!particleLayerRef.current) return;
    const scaledCount = clamp(Math.round(count * preset.burstScale), 2, preset.burstCap);
    const sparkleColor = sparkle?.color ? hexToColor(sparkle.color) : lighten(slime.color, 0.32);
    for (let i = 0; i < scaledCount; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: sparkleColor, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(burstGeometry, material);
      mesh.position.set(0, -0.02, 0.95);
      particleLayerRef.current.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.55 + Math.random() * 0.7;
      burstParticlesRef.current.push({
        mesh, material,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, (Math.random() - 0.2) * speed + 0.4, (Math.random() - 0.5) * 0.5),
        life: 0, ttl: 0.45 + Math.random() * 0.28,
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
        transmission: 0.75, thickness: 0.5, roughness: 0.1, clearcoat: 0.9, ior: 1.18, transparent: true, opacity: 0.85,
      });
      const mesh = new THREE.Mesh(fragmentGeometry, material);
      mesh.scale.setScalar(size);
      mesh.position.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2 + 0.1);
      fragmentLayerRef.current.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.3) * Math.PI;
      const speed = 1.8 + Math.random() * 2.2;
      fragmentsRef.current.push({
        mesh, material,
        velocity: new THREE.Vector3(Math.cos(angle) * Math.cos(elevation) * speed, Math.sin(elevation) * speed + 1.0, Math.sin(angle) * Math.cos(elevation) * speed * 0.5),
        angularVelocity: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        origin: mesh.position.clone(), life: 0, reforming: false, scale: size,
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
    window.setTimeout(() => { if (!isDraggingRef.current) targetScaleRef.current.set(1, 1, 1); }, 280);
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
        if (!isDraggingRef.current) {
          targetScaleRef.current.set(0.92, 1.08, 0.96);
          window.setTimeout(() => { if (!isDraggingRef.current) targetScaleRef.current.set(1, 1, 1); }, 120);
        }
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
    fragmentsRef.current.forEach((f) => { f.mesh.removeFromParent(); f.material.dispose(); });
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
      const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color().setHSL(hue / 360, 0.8, 0.55),
        transmission: 0.5, thickness: 0.4, roughness: 0.1, clearcoat: 1, ior: 1.2, transparent: true, opacity: 0.95,
        emissive: baseColor, emissiveIntensity: 0.3,
      });
      const mesh = new THREE.Mesh(megaFragGeometry, material);
      mesh.scale.setScalar(size);
      megaLayerRef.current.add(mesh);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      megaStateRef.current.fragments.push({
        mesh, material, angle,
        radius: 0.5 + Math.random() * 1.5, speed: 2 + Math.random() * 3,
        yOffset: (Math.random() - 0.5) * 1.2, size,
        orbitAxis: new THREE.Vector3(Math.random() - 0.5, 1 + Math.random(), Math.random() - 0.5).normalize(),
      });
    }
  };

  useFrame((state, delta) => {
    const d = clamp(delta * 60, 0, 2.4);
    const t = state.clock.elapsedTime;

    if (isDraggingRef.current && !pinchRef.current.active) {
      // Subtle body lean — localized stretch is now the primary effect
      targetPosRef.current.set(pointer.x * 0.35, pointer.y * 0.25 - 0.02, 0);
      const dist = Math.min(1, Math.hypot(pointer.x, pointer.y));
      targetScaleRef.current.set(1 + dist * 0.08, 1 - dist * 0.06, 1);

      // Update localized pull toward pointer delta
      if (dragHitLocalRef.current) {
        const dx = (pointer.x - dragStartPointerRef.current.x) * 1.8;
        const dy = (pointer.y - dragStartPointerRef.current.y) * 1.5;
        const pullMag = Math.sqrt(dx * dx + dy * dy);
        const prevX = dragPullRef.current.x;
        const prevY = dragPullRef.current.y;
        const prevZ = dragPullRef.current.z;
        dragPullRef.current.x += (dx - dragPullRef.current.x) * 0.15 * d;
        dragPullRef.current.y += (dy - dragPullRef.current.y) * 0.15 * d;
        dragPullRef.current.z += (pullMag * 0.3 - dragPullRef.current.z) * 0.15 * d;
        const len = dragPullRef.current.length();
        if (len > 1.5) dragPullRef.current.multiplyScalar(1.5 / len);
        if (delta > 0.001) {
          dragVelocityRef.current.set(
            (dragPullRef.current.x - prevX) / delta,
            (dragPullRef.current.y - prevY) / delta,
            (dragPullRef.current.z - prevZ) / delta,
          );
        }
      }
    }

    // Spring-back for localized stretch after release
    if (!isDraggingRef.current && dragHitLocalRef.current) {
      const pull = dragPullRef.current;
      const vel = dragVelocityRef.current;
      vel.x += (-16 * pull.x - 4 * vel.x) * delta;
      vel.y += (-16 * pull.y - 4 * vel.y) * delta;
      vel.z += (-16 * pull.z - 4 * vel.z) * delta;
      pull.x += vel.x * delta;
      pull.y += vel.y * delta;
      pull.z += vel.z * delta;
      if (pull.lengthSq() < 0.0001 && vel.lengthSq() < 0.01) {
        pull.set(0, 0, 0); vel.set(0, 0, 0); dragHitLocalRef.current = null;
      }
    }

    currentPosRef.current.lerp(targetPosRef.current, 0.12 * d);
    currentScaleRef.current.lerp(targetScaleRef.current, 0.14 * d);

    const levelScale = 1 + Math.min(slimeLevel - 1, 9) * 0.04;
    const breathe = (1 + Math.sin(t * 1.8) * 0.022) * levelScale;
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
          const shifted = new THREE.Color().setHSL((baseHSL.h + ms.hueShift) % 1, Math.min(1, baseHSL.s + 0.3), baseHSL.l);
          if ('color' in mat) (mat as unknown as { color: THREE.Color }).color.copy(shifted);
        }
        if (ms.phaseTime > 0.6) {
          ms.phase = 'explode'; ms.phaseTime = 0; bodyVisibleRef.current = false;
          spawnMegaFragments(20); spawnBurst(30); burstGlowRef.current += 1.5;
          ms.shockwaveScale = 0.1; ms.shockwaveOpacity = 1;
        }
      } else if (ms.phase === 'explode') {
        const progress = clamp(ms.phaseTime / 0.4, 0, 1);
        ms.fragments.forEach((f) => {
          const r = f.radius * progress * 2; f.angle += delta * f.speed;
          f.mesh.position.set(Math.cos(f.angle) * r, f.yOffset * progress * 2 + Math.sin(f.angle * 0.7) * 0.3, Math.sin(f.angle) * r * 0.5);
          f.mesh.rotation.x += delta * 5; f.mesh.rotation.y += delta * 7;
          f.mesh.scale.setScalar(f.size * (1 + Math.sin(ms.time * 15) * 0.2));
        });
        ms.shockwaveScale += delta * 12; ms.shockwaveOpacity = Math.max(0, 1 - progress);
        if (ms.phaseTime > 0.4) { ms.phase = 'orbit'; ms.phaseTime = 0; }
      } else if (ms.phase === 'orbit') {
        ms.hueShift += delta * 1.5;
        const orbitProgress = clamp(ms.phaseTime / 2.0, 0, 1);
        ms.fragments.forEach((f, i) => {
          f.angle += delta * f.speed * (1 - orbitProgress * 0.5);
          const r = f.radius * (1.5 - orbitProgress * 0.8);
          f.mesh.position.set(Math.cos(f.angle) * r, f.yOffset * (1 - orbitProgress * 0.5) + Math.sin(t * 3 + i) * 0.2, Math.sin(f.angle) * r * 0.6);
          f.mesh.rotation.x += delta * 3 * (1 - orbitProgress * 0.5);
          f.mesh.rotation.y += delta * 4 * (1 - orbitProgress * 0.5);
          const hue = ((i / ms.fragments.length) + ms.hueShift) % 1;
          f.material.color.setHSL(hue, 0.85, 0.55);
          f.material.emissive.setHSL(hue, 0.9, 0.3);
          f.material.emissiveIntensity = 0.5 + Math.sin(t * 6 + i * 0.5) * 0.3;
          f.mesh.scale.setScalar(f.size * (1 + Math.sin(t * 8 + i) * 0.15));
        });
        if (ms.phaseTime > 0.5 && ms.phaseTime < 1.8) {
          const newPulseCount = Math.floor((ms.phaseTime - 0.5) / 0.35);
          if (newPulseCount > ms.pulseCount) { ms.pulseCount = newPulseCount; spawnBurst(6); burstGlowRef.current += 0.3; }
        }
        ms.shockwaveOpacity = 0;
        if (ms.phaseTime > 2.0) { ms.phase = 'reform'; ms.phaseTime = 0; ms.shockwaveScale = 0.1; ms.shockwaveOpacity = 0.8; }
      } else if (ms.phase === 'reform') {
        const progress = clamp(ms.phaseTime / 0.8, 0, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        ms.fragments.forEach((f) => {
          f.mesh.position.lerp(new THREE.Vector3(0, 0, 0), ease * 0.15);
          f.mesh.rotation.x += delta * (1 - ease) * 5; f.mesh.rotation.y += delta * (1 - ease) * 5;
          f.mesh.scale.setScalar(Math.max(0.01, f.size * (1 - ease * 0.7)));
          f.material.opacity = 1 - ease;
        });
        ms.shockwaveScale += delta * 8; ms.shockwaveOpacity = Math.max(0, 0.8 - progress);
        if (progress > 0.5 && !bodyVisibleRef.current) bodyVisibleRef.current = true;
        if (rootRef.current) {
          const bounceBack = 1 + (1 - ease) * 0.5;
          const squishReform = ease < 0.5 ? 1 + (1 - ease * 2) * 0.3 : 1 - (ease - 0.5) * 0.1;
          rootRef.current.scale.set(squishReform * bounceBack * 0.9, (2 - squishReform) * bounceBack * 0.9, bounceBack * 0.95);
        }
        if (ms.phaseTime > 0.8) {
          ms.active = false; ms.phase = 'none'; cleanupMegaFragments();
          bodyVisibleRef.current = true; targetScaleRef.current.set(1.15, 0.88, 1.05);
          spawnBurst(15); burstGlowRef.current += 0.6;
          if (outerRef.current) {
            const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
            if ('color' in mat) (mat as unknown as { color: THREE.Color }).color.copy(hexToColor(slime.color));
          }
          window.setTimeout(() => { if (!isDraggingRef.current) targetScaleRef.current.set(1, 1, 1); }, 300);
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
        const bx = basePositions[i]; const by = basePositions[i + 1]; const bz = basePositions[i + 2];
        const nx = normals[i]; const ny = normals[i + 1]; const nz = normals[i + 2];
        const waveA = Math.sin(t * 2.2 + nx * 4.2 + ny * 5.8 + nz * 3.7) * displacement;
        const waveB = Math.cos(t * 3.1 + nx * 6.5 - ny * 4.1 + nz * 6.8) * displacement * 0.55;
        const waveC = Math.sin(t * 4.3 + nx * 3.1 + ny * 7.2 - nz * 5.4) * displacement * 0.28;
        const radiusScale = 1 + waveA + waveB + waveC;
        arr[i] = bx * radiusScale;
        arr[i + 1] = by * (1 + waveA * 0.85 + waveB * 0.5 + waveC * 0.3);
        arr[i + 2] = bz * (1 + waveA * 0.9 + waveB * 0.65 + waveC * 0.35);

        // Localized stretch deformation
        if (dragHitLocalRef.current && dragPullRef.current.lengthSq() > 0.0001) {
          const dvx = bx - dragHitLocalRef.current.x;
          const dvy = by - dragHitLocalRef.current.y;
          const dvz = bz - dragHitLocalRef.current.z;
          const distSq = dvx * dvx + dvy * dvy + dvz * dvz;
          const influence = Math.exp(-distSq * PULL_FALLOFF);
          arr[i] += dragPullRef.current.x * influence;
          arr[i + 1] += dragPullRef.current.y * influence;
          arr[i + 2] += dragPullRef.current.z * influence;
        }
      }
      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    // --- Blinking ---
    blinkTimerRef.current += delta;
    if (blinkTimerRef.current > 3 + Math.sin(t * 0.3) * 1.5) { blinkRef.current = 1; blinkTimerRef.current = 0; }
    if (blinkRef.current > 0) blinkRef.current = Math.max(0, blinkRef.current - delta * 6);
    const blinkScale = eyeStyle === 'sleepy' ? 0.6 : 1 - blinkRef.current * 0.85;

    // --- Eye tracking ---
    const eyeLookX = clamp(pointer.x * 0.07, -0.06, 0.06);
    const eyeLookY = clamp(pointer.y * 0.05, -0.04, 0.04);

    if (leftEyeGroupRef.current) leftEyeGroupRef.current.scale.y = blinkScale;
    if (rightEyeGroupRef.current) rightEyeGroupRef.current.scale.y = blinkScale;

    if (eyeStyle === 'googly') {
      const gv = googlyVelocityRef.current;
      const gp = googlyPosRef.current;
      const gravity = -0.8;
      const damping = 0.92;
      const bounce = 0.6;
      const maxR = 0.06;

      gv.lx += (eyeLookX * 3 - gp.lx * 8) * delta; gv.ly += (eyeLookY * 3 - gp.ly * 8 + gravity) * delta;
      gv.rx += (eyeLookX * 3 - gp.rx * 8) * delta; gv.ry += (eyeLookY * 3 - gp.ry * 8 + gravity) * delta;
      gv.lx *= damping; gv.ly *= damping; gv.rx *= damping; gv.ry *= damping;
      gp.lx += gv.lx * delta; gp.ly += gv.ly * delta;
      gp.rx += gv.rx * delta; gp.ry += gv.ry * delta;
      const clampCircle = (x: number, y: number) => {
        const d = Math.sqrt(x * x + y * y);
        if (d > maxR) { const s = maxR / d; return [x * s, y * s]; }
        return [x, y];
      };
      const [lx2, ly2] = clampCircle(gp.lx, gp.ly);
      const [rx2, ry2] = clampCircle(gp.rx, gp.ry);
      gp.lx = lx2; gp.ly = ly2; gp.rx = rx2; gp.ry = ry2;

      if (Math.sqrt(lx2 * lx2 + ly2 * ly2) >= maxR * 0.98) { gv.lx *= -bounce; gv.ly *= -bounce; }
      if (Math.sqrt(rx2 * rx2 + ry2 * ry2) >= maxR * 0.98) { gv.rx *= -bounce; gv.ry *= -bounce; }

      if (leftPupilRef.current) leftPupilRef.current.position.set(gp.lx, gp.ly, 0.12);
      if (rightPupilRef.current) rightPupilRef.current.position.set(gp.rx, gp.ry, 0.12);
    } else if (eyeStyle === 'normal' || eyeStyle === 'angry' || eyeStyle === 'cyclops') {
      if (leftIrisRef.current) leftIrisRef.current.position.set(eyeLookX * 0.65, eyeLookY * 0.65, 0.08);
      if (rightIrisRef.current) rightIrisRef.current.position.set(eyeLookX * 0.65, eyeLookY * 0.65, 0.08);
      if (leftPupilRef.current) leftPupilRef.current.position.set(eyeLookX * 0.85, eyeLookY * 0.85, eyeStyle === 'cyclops' ? 0.15 : 0.11);
      if (rightPupilRef.current) rightPupilRef.current.position.set(eyeLookX * 0.85, eyeLookY * 0.85, eyeStyle === 'cyclops' ? 0.15 : 0.11);
    }

    // --- Accessory + face stretch following ---
    const pullActive = dragHitLocalRef.current != null && dragPullRef.current.lengthSq() > 0.0001;

    const pullInfluence = (bx: number, by: number, bz: number, scale: number) => {
      if (!pullActive) return { x: 0, y: 0, z: 0 };
      const dvx = bx - dragHitLocalRef.current!.x;
      const dvy = by - dragHitLocalRef.current!.y;
      const dvz = bz - dragHitLocalRef.current!.z;
      const inf = Math.exp(-(dvx * dvx + dvy * dvy + dvz * dvz) * PULL_FALLOFF) * scale;
      return { x: dragPullRef.current.x * inf, y: dragPullRef.current.y * inf, z: dragPullRef.current.z * inf };
    };

    // Mouth follows stretch
    if (mouthRef.current) {
      const mo = pullInfluence(0, -0.28, 0.9, 0.6);
      mouthRef.current.position.set(mo.x, -0.28 + mo.y, 0.9 + mo.z);
      mouthRef.current.scale.set(1 + burstGlowRef.current * 0.55, 1 + burstGlowRef.current * 0.25, 1);
      mouthRef.current.rotation.z = Math.sin(t * 1.7) * 0.1;
    }

    // Eyes follow stretch (offset within their positioning group)
    {
      const lo = pullInfluence(-0.3, 0.15, 0.88, 0.5);
      const ro = pullInfluence(0.3, 0.15, 0.88, 0.5);
      if (leftEyeGroupRef.current) leftEyeGroupRef.current.position.set(lo.x, lo.y, lo.z);
      if (rightEyeGroupRef.current) rightEyeGroupRef.current.position.set(ro.x, ro.y, ro.z);
    }

    // Clothing follows stretch
    if (clothingGroupRef.current) {
      clothingGroupRef.current.visible = bodyVisibleRef.current;
      if (bodyVisibleRef.current) {
        const base = clothingBaseRef.current;
        const co = pullInfluence(base.x, base.y, base.z, 1);
        clothingGroupRef.current.position.set(base.x + co.x, base.y + co.y, base.z + co.z);
      }
    }

    // Charm follows stretch
    if (charmGroupRef.current) {
      charmGroupRef.current.visible = bodyVisibleRef.current;
      if (bodyVisibleRef.current) {
        const base = charmBaseRef.current;
        const co = pullInfluence(base.x, base.y, base.z, 0.8);
        charmGroupRef.current.position.set(base.x + co.x, base.y + co.y, base.z + co.z);
      }
    }

    if (sparkleRef.current) {
      sparkleRef.current.rotation.y += delta * 0.36;
      sparkleRef.current.children.forEach((child, index) => {
        child.position.y += Math.sin(t * 1.8 + index * 1.7) * 0.0009;
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.42 + Math.sin(t * 2.4 + index) * 0.2 + burstGlowRef.current * 0.4;
      });
    }

    // --- Burst particles ---
    for (let i = burstParticlesRef.current.length - 1; i >= 0; i -= 1) {
      const p = burstParticlesRef.current[i];
      p.life += delta; p.mesh.position.addScaledVector(p.velocity, delta * 2.1); p.velocity.y -= delta * 0.9;
      const lifeRatio = clamp(p.life / p.ttl, 0, 1);
      p.material.opacity = 1 - lifeRatio; p.mesh.scale.setScalar(0.72 + lifeRatio * 1.2);
      if (lifeRatio >= 1) { p.mesh.removeFromParent(); p.material.dispose(); burstParticlesRef.current.splice(i, 1); }
    }

    // --- Fragment reformation ---
    for (let i = fragmentsRef.current.length - 1; i >= 0; i--) {
      const frag = fragmentsRef.current[i];
      frag.life += delta;
      if (frag.life < 1.2) {
        frag.mesh.position.addScaledVector(frag.velocity, delta);
        frag.velocity.y -= delta * 2.5; frag.velocity.multiplyScalar(0.98);
        frag.mesh.rotation.x += frag.angularVelocity.x * delta;
        frag.mesh.rotation.y += frag.angularVelocity.y * delta;
        frag.mesh.rotation.z += frag.angularVelocity.z * delta;
      } else {
        if (!frag.reforming) frag.reforming = true;
        frag.mesh.position.lerp(new THREE.Vector3(0, -0.02, 0), 0.035 * d);
        frag.mesh.rotation.x *= 0.96; frag.mesh.rotation.y *= 0.96; frag.mesh.rotation.z *= 0.96;
        if (frag.mesh.position.length() < 0.15) {
          frag.material.opacity = clamp(frag.material.opacity - delta * 1.5, 0, 1);
          frag.mesh.scale.setScalar(Math.max(0.01, frag.scale * frag.material.opacity));
        }
        if (frag.material.opacity <= 0.02) {
          frag.mesh.removeFromParent(); frag.material.dispose(); fragmentsRef.current.splice(i, 1);
          if (fragmentsRef.current.length === 0) bodyVisibleRef.current = true;
        }
      }
      if (frag.life > 0.3 && frag.life < 1.2) {
        frag.mesh.scale.setScalar(frag.scale * (1 + Math.sin(frag.life * 8 + i) * 0.1));
      }
    }

    // --- Body visibility ---
    if (outerRef.current) {
      const targetOp = bodyVisibleRef.current ? 1 : 0;
      const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
      if ('opacity' in mat) mat.opacity = THREE.MathUtils.lerp(mat.opacity ?? 1, targetOp, 0.15 * d);
      outerRef.current.visible = (mat.opacity ?? 0) > 0.01;
    }
    if (innerRef.current) innerRef.current.visible = bodyVisibleRef.current;
    if (rimRef.current) {
      (rimRef.current.material as THREE.MeshBasicMaterial).opacity = bodyVisibleRef.current ? clamp(0.14 + burstGlowRef.current * 0.28, 0.14, 0.42) : 0;
    }
    if (outerRef.current && bodyVisibleRef.current) {
      const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
      const levelGlow = Math.min(slimeLevel - 1, 9) * 0.04;
      mat.clearcoat = clamp(0.8 + burstGlowRef.current * 0.65 + levelGlow, 0.8, 1);
      mat.sheen = clamp(0.42 + burstGlowRef.current * 0.5 + levelGlow * 0.8, 0.42, 0.95);
      mat.sheenRoughness = clamp(0.38 - burstGlowRef.current * 0.2 - levelGlow * 0.3, 0.1, 0.38);
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

      <mesh ref={shockwaveRef} position={[0, 0, 0.5]} visible={false}>
        <ringGeometry args={[0.8, 1, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      <group ref={megaLayerRef} />

      <group
        ref={rootRef}
        position={[0, -0.02, 0]}
        onPointerDown={(event) => {
          event.stopPropagation();
          isDraggingRef.current = true;

          // Capture local-space hit point for localized stretching
          if (rootRef.current && event.point) {
            const localPoint = event.point.clone();
            rootRef.current.worldToLocal(localPoint);
            dragHitLocalRef.current = localPoint;
            dragStartPointerRef.current.set(pointer.x, pointer.y);
            dragPullRef.current.set(0, 0, 0);
            dragVelocityRef.current.set(0, 0, 0);
          }

          spawnBurst(4);
          onInteract?.('drag');
        }}
      >
        <group ref={particleLayerRef} />
        <group ref={fragmentLayerRef} />

        <mesh ref={rimRef} geometry={rimGeometry}>
          <meshBasicMaterial color={rimColor} transparent opacity={0.14} side={THREE.BackSide} depthWrite={false} />
        </mesh>

        <mesh ref={outerRef} geometry={geometry}>
          <MeshTransmissionMaterial
            backside
            thickness={1.6}
            roughness={preset.roughness}
            samples={preset.transmissionSamples}
            chromaticAberration={preset.chromaticAberration}
            anisotropicBlur={preset.anisotropicBlur}
            distortion={preset.distortion}
            distortionScale={preset.distortionScale}
            temporalDistortion={preset.temporalDistortion}
            clearcoat={1}
            clearcoatRoughness={0.08}
            ior={1.22}
            color={baseColor}
            attenuationColor={baseColor}
            attenuationDistance={1.4}
          />
        </mesh>

        <mesh ref={innerRef} geometry={innerGeometry} position={[0, 0.05, -0.04]}>
          <SlimeSSSMaterial color={innerColor} opacity={0.6} />
        </mesh>

        <group ref={sparkleRef}>
          {sparklePoints.map((point, index) => (
            <mesh key={index} position={point}>
              <sphereGeometry args={[0.05, preset.sparkleSegments, preset.sparkleSegments]} />
              <meshStandardMaterial color={sparkle?.color ?? '#dfe6e9'} emissive={sparkle?.color ?? '#ffffff'} emissiveIntensity={0.5} transparent opacity={0.8} roughness={0.2} metalness={0.1} />
            </mesh>
          ))}
        </group>

        {charmTexture && (
          <group ref={charmGroupRef}>
            <sprite scale={[0.5, 0.5, 0.5]} renderOrder={10}>
              <spriteMaterial map={charmTexture} transparent depthWrite={false} depthTest={false} />
            </sprite>
          </group>
        )}

        {renderEyePair(
          eyeStyle,
          { leftGroupRef: leftEyeGroupRef, rightGroupRef: rightEyeGroupRef, leftIrisRef, rightIrisRef, leftPupilRef, rightPupilRef },
          irisColor,
        )}

        <mesh ref={mouthRef} position={[0, -0.28, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.03, 16, 48, Math.PI]} />
          <meshStandardMaterial color="#2d3436" roughness={0.45} />
        </mesh>

        <ClothingRenderer clothingId={clothing} groupRef={clothingGroupRef} />
      </group>
    </>
  );
};

export const PixiSlimeStage = forwardRef<PixiSlimeStageHandle, PixiSlimeStageProps>(
  function PixiSlimeStage({ slime, eyeStyle, clothing, slimeLevel, onInteract }, ref) {
    const controlsRef = useRef<StageControls | null>(null);

    useImperativeHandle(ref, () => ({
      poke: () => controlsRef.current?.poke(),
      squish: () => controlsRef.current?.squish(),
      stretch: () => controlsRef.current?.stretch(),
      bounce: () => controlsRef.current?.bounce(),
      megaMorph: () => controlsRef.current?.megaMorph(),
      burst: (count?: number) => controlsRef.current?.burst(count),
    }), []);

    if (!slime) return <div className="pixi-host" />;

    return (
      <div className="pixi-host">
        <Canvas
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          dpr={ULTRA_PRESET.dpr}
          camera={{ fov: 42, near: 0.1, far: 100, position: [0, 0.12, 4.1] }}
          style={{ background: 'transparent' }}
        >
          <SlimeScene
            slime={slime}
            eyeStyle={eyeStyle}
            clothing={clothing}
            slimeLevel={slimeLevel}
            onInteract={onInteract}
            onReady={(controls) => { controlsRef.current = controls; }}
          />
          <EffectComposer multisampling={4} enableNormalPass={false}>
            <Bloom
              intensity={0.55}
              luminanceThreshold={0.62}
              luminanceSmoothing={0.25}
              mipmapBlur
            />
            <DepthOfField
              focusDistance={0.015}
              focalLength={0.04}
              bokehScale={2}
            />
            <ChromaticAberration
              offset={new THREE.Vector2(0.0008, 0.0008)}
              blendFunction={BlendFunction.NORMAL}
              radialModulation={false}
              modulationOffset={0}
            />
            <Vignette
              offset={0.3}
              darkness={0.55}
              blendFunction={BlendFunction.NORMAL}
            />
          </EffectComposer>
        </Canvas>
      </div>
    );
  },
);
