import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from 'pixi.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { findCharm, findSparkle } from '../gameData';
import {
  clamp,
  createShake,
  easeOutCubic,
  lerp,
  playSfx,
  rand,
  updateShake,
  type ScreenShake,
} from '../game/juice';
import {
  getPersonality,
  moodToExpression,
  type SlimePersonality,
  type MoodExpression,
} from '../game/slimePersonality';
import type { Slime } from '../types';

type InteractionKind = 'drag' | 'poke' | 'squish' | 'stretch' | 'bounce' | 'mega';

export interface PixiSlimeStageHandle {
  poke: () => void;
  squish: () => void;
  stretch: () => void;
  bounce: () => void;
  megaMorph: () => void;
  burst: (count?: number) => void;
  setMood: (mood: string) => void;
}

interface PixiSlimeStageProps {
  slime: Slime | null;
  onInteract?: (kind: InteractionKind) => void;
}

/* ===============================
   ACTION STATE
   =============================== */

interface ActionState {
  kind: InteractionKind | null;
  t: number;
  duration: number;
  intensity: number;
  dirX: number;
  dirY: number;
}

/* ===============================
   ULTIMATE STATE
   =============================== */

type UltPhase = 'idle' | 'charge' | 'explode' | 'afterglow';

interface UltimateState {
  active: boolean;
  phase: UltPhase;
  t: number;
  auraT: number;
}

/* ===============================
   EXPRESSION STATE
   =============================== */

interface ExpressionState {
  blinkProgress: number;
  blinkTimer: number;
  isBlinking: boolean;
  currentExpression: MoodExpression;
}

/* ===============================
   STAGE RIG
   =============================== */

interface StageRig {
  app: Application;
  width: number;
  height: number;
  root: Container;
  slime: Container;
  vfxContainer: Container;
  groundShadow: Graphics;
  bodyFill: Graphics;
  bodyRim: Graphics;
  bodyDepth: Graphics;
  sheen: Graphics;
  leftEyeWhite: Graphics;
  rightEyeWhite: Graphics;
  leftPupil: Graphics;
  rightPupil: Graphics;
  leftBrow: Graphics;
  rightBrow: Graphics;
  leftCheek: Graphics;
  rightCheek: Graphics;
  mouth: Graphics;
  sparkleContainer: Container;
  auraGlow: Graphics;
  auraRing: Container;
  particles: Array<{
    g: Graphics;
    vx: number;
    vy: number;
    ttl: number;
    age: number;
    type?: 'sparkle' | 'star' | 'confetti' | 'ring';
  }>;
  centerX: number;
  centerY: number;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  targetScaleX: number;
  targetScaleY: number;
  currentScaleX: number;
  currentScaleY: number;
  isDragging: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  wobblePhase: number;
  colorHex: number;
  lightHex: number;
  darkHex: number;
  personality: SlimePersonality;
  action: ActionState;
  ultimate: UltimateState;
  expression: ExpressionState;
  shake: ScreenShake;
  megaText: Text | null;
}

const MAX_STAGE_WIDTH = 500;
const STAGE_ASPECT = 0.72;

/* ===============================
   COLOR UTILS
   =============================== */

function hexToNumber(hex: string): number {
  const cleaned = hex.replace('#', '');
  const parsed = Number.parseInt(cleaned, 16);
  if (Number.isNaN(parsed)) return 0x55efc4;
  return parsed;
}

function lightenHex(hex: string, percent: number): number {
  const value = hexToNumber(hex);
  const r = Math.min(255, (value >> 16) + Math.round((255 * percent) / 100));
  const g = Math.min(255, ((value >> 8) & 0xff) + Math.round((255 * percent) / 100));
  const b = Math.min(255, (value & 0xff) + Math.round((255 * percent) / 100));
  return (r << 16) + (g << 8) + b;
}

function darkenHex(hex: string, percent: number): number {
  const value = hexToNumber(hex);
  const r = Math.max(0, (value >> 16) - Math.round((255 * percent) / 100));
  const g = Math.max(0, ((value >> 8) & 0xff) - Math.round((255 * percent) / 100));
  const b = Math.max(0, (value & 0xff) - Math.round((255 * percent) / 100));
  return (r << 16) + (g << 8) + b;
}

/* ===============================
   FACE DRAWING
   =============================== */

function drawMouthShape(
  mouth: Graphics,
  personality: SlimePersonality,
  expression: MoodExpression,
  actionHappy: boolean,
): void {
  mouth.clear();
  let width: number;
  let controlY: number;
  if (actionHappy) {
    width = 26;
    controlY = 16;
  } else {
    switch (expression) {
      case 'excited':
        width = personality.mouthStyle === 'grin' ? 30 : 24;
        controlY = personality.mouthStyle === 'open' ? 20 : 16;
        break;
      case 'playful':
        width = 22;
        controlY = 12;
        break;
      default:
        width = personality.mouthStyle === 'smirk' ? 18 : 20;
        controlY = personality.mouthStyle === 'smile' ? 10 : 8;
        break;
    }
  }
  const offsetX = personality.mouthStyle === 'smirk' ? 4 : 0;
  mouth.moveTo(-width + offsetX, 0);
  mouth.bezierCurveTo(-width * 0.55 + offsetX, controlY, width * 0.55 + offsetX, controlY, width + offsetX, 0);
  mouth.stroke({ color: 0x2d3436, width: 4, cap: 'round', join: 'round' });
  if ((personality.mouthStyle === 'open' && expression === 'excited') || actionHappy) {
    mouth.moveTo(-width * 0.6 + offsetX, 2);
    mouth.bezierCurveTo(-width * 0.35 + offsetX, controlY * 0.7, width * 0.35 + offsetX, controlY * 0.7, width * 0.6 + offsetX, 2);
    mouth.fill({ color: 0x2d3436, alpha: 0.15 });
  }
}

function drawEyes(rig: StageRig): void {
  const p = rig.personality;
  const blink = rig.expression.blinkProgress;
  rig.leftEyeWhite.clear();
  rig.rightEyeWhite.clear();
  let eyeW: number;
  let eyeH: number;
  switch (p.eyeStyle) {
    case 'oval': eyeW = 14; eyeH = 19; break;
    case 'sleepy': eyeW = 13; eyeH = 14; break;
    default: eyeW = 12; eyeH = 17;
  }
  const blinkScale = 1 - blink * 0.9;
  const effectiveH = eyeH * blinkScale;
  rig.leftEyeWhite.ellipse(-34, -20, eyeW, effectiveH).fill({ color: 0xffffff });
  rig.rightEyeWhite.ellipse(34, -20, eyeW, effectiveH).fill({ color: 0xffffff });
  let pupilR: number;
  switch (p.pupilSize) {
    case 'small': pupilR = 3.5; break;
    case 'large': pupilR = 6.5; break;
    default: pupilR = 5;
  }
  rig.leftPupil.clear();
  rig.rightPupil.clear();
  if (blink < 0.7) {
    rig.leftPupil.circle(0, 0, pupilR).fill({ color: 0x2d3436 });
    rig.rightPupil.circle(0, 0, pupilR).fill({ color: 0x2d3436 });
    rig.leftPupil.circle(-pupilR * 0.3, -pupilR * 0.35, pupilR * 0.3).fill({ color: 0xffffff, alpha: 0.5 });
    rig.rightPupil.circle(-pupilR * 0.3, -pupilR * 0.35, pupilR * 0.3).fill({ color: 0xffffff, alpha: 0.5 });
  }
}

function drawBrows(rig: StageRig): void {
  rig.leftBrow.clear();
  rig.rightBrow.clear();
  if (rig.personality.browStyle === 'none') return;
  const expr = rig.expression.currentExpression;
  const browY = expr === 'excited' ? -46 : -42;
  const tiltL = expr === 'excited' ? -0.15 : 0;
  const tiltR = expr === 'excited' ? 0.15 : 0;
  rig.leftBrow.moveTo(-8, 0).lineTo(8, 0).stroke({ color: 0x2d3436, width: 3, cap: 'round' });
  rig.leftBrow.position.set(-34, browY);
  rig.leftBrow.rotation = tiltL;
  rig.rightBrow.moveTo(-8, 0).lineTo(8, 0).stroke({ color: 0x2d3436, width: 3, cap: 'round' });
  rig.rightBrow.position.set(34, browY);
  rig.rightBrow.rotation = tiltR;
}

function drawCheeks(rig: StageRig): void {
  rig.leftCheek.clear();
  rig.rightCheek.clear();
  if (rig.personality.cheekStyle === 'none') return;
  const expr = rig.expression.currentExpression;
  const alpha = expr === 'excited' || expr === 'playful' ? 0.25 : 0.15;
  if (rig.personality.cheekStyle === 'blush') {
    rig.leftCheek.circle(0, 0, 7).fill({ color: 0xff9999, alpha });
    rig.rightCheek.circle(0, 0, 7).fill({ color: 0xff9999, alpha });
  } else {
    rig.leftCheek.ellipse(0, 0, 12, 8).fill({ color: 0xff9999, alpha: alpha * 0.7 });
    rig.rightCheek.ellipse(0, 0, 12, 8).fill({ color: 0xff9999, alpha: alpha * 0.7 });
  }
  rig.leftCheek.position.set(-52, 8);
  rig.rightCheek.position.set(52, 8);
}

/* ===============================
   BLOB / BODY
   =============================== */

function makeBlobPoints(
  radiusX: number,
  radiusY: number,
  wobble: number,
  phase: number,
  action: ActionState,
): number[] {
  const points: number[] = [];
  const segments = 44;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const waveA = Math.sin(angle * 3 + phase) * wobble;
    const waveB = Math.cos(angle * 5 - phase * 1.25) * wobble * 0.55;
    let wave = waveA + waveB;

    if (action.kind && action.t < action.duration) {
      const progress = action.t / action.duration;
      const fade = 1 - easeOutCubic(progress);
      switch (action.kind) {
        case 'poke': {
          const dist = Math.abs(angle - Math.PI * 1.5);
          wave -= Math.exp(-dist * dist * 2) * 0.15 * fade;
          wave += Math.sin(angle * 8 - progress * 12) * 0.03 * fade;
          break;
        }
        case 'squish':
          wave += Math.cos(angle * 2) * 0.08 * fade * action.intensity;
          break;
        case 'stretch': {
          const pullDir = Math.cos(angle - Math.atan2(action.dirY, action.dirX));
          wave += pullDir * 0.06 * fade * action.intensity;
          wave += Math.sin(angle * 6 + progress * 10) * 0.02 * fade;
          break;
        }
        case 'bounce':
          if (progress > 0.4) {
            wave += Math.cos(angle * 2) * Math.sin(((progress - 0.4) / 0.6) * Math.PI) * 0.06;
          }
          wave += Math.sin(angle * 10 + progress * 20) * 0.015 * fade;
          break;
        case 'mega':
          wave += Math.sin(angle * 4 + progress * 8) * 0.08 * fade;
          wave += Math.cos(angle * 7 - progress * 15) * 0.04 * fade;
          break;
      }
    }
    points.push(Math.cos(angle) * radiusX * (1 + wave), Math.sin(angle) * radiusY * (1 - wave * 0.45));
  }
  return points;
}

const noAction: ActionState = { kind: null, t: 0, duration: 0, intensity: 1, dirX: 0, dirY: 0 };

function drawBlob(graphics: Graphics, points: number[], color: number, alpha = 1): void {
  graphics.clear();
  graphics.poly(points, true).fill({ color, alpha });
}

function drawBlobWithStroke(
  graphics: Graphics,
  points: number[],
  color: number,
  strokeColor: number,
  strokeWidth: number,
  alpha = 1,
): void {
  graphics.clear();
  graphics.poly(points, true).fill({ color, alpha });
  graphics.poly(points, true).stroke({ color: strokeColor, alpha: 0.6, width: strokeWidth });
}

function drawBody(rig: StageRig, wobbleStrength: number): void {
  const radiusX = 118;
  const radiusY = 92;
  const points = makeBlobPoints(radiusX, radiusY, wobbleStrength, rig.wobblePhase, rig.action);
  const innerPoints = makeBlobPoints(radiusX * 0.9, radiusY * 0.58, wobbleStrength * 0.7, rig.wobblePhase + 0.9, noAction);
  drawBlobWithStroke(rig.bodyFill, points, rig.colorHex, rig.lightHex, 3, 0.98);
  drawBlob(rig.bodyRim, points, rig.lightHex, 0.1);
  drawBlob(rig.bodyDepth, innerPoints, rig.darkHex, 0.26);
  rig.bodyDepth.position.set(0, 35);
  rig.sheen.clear();
  rig.sheen.ellipse(-26, -40, 62, 27).fill({ color: 0xffffff, alpha: 0.28 });
  rig.sheen.ellipse(6, -30, 48, 18).fill({ color: 0xffffff, alpha: 0.1 });
  rig.sheen.rotation = Math.sin(rig.wobblePhase * 0.7) * 0.04;
}

/* ===============================
   AURA
   =============================== */

function drawAura(rig: StageRig): void {
  rig.auraGlow.clear();
  if (!rig.ultimate.active && rig.ultimate.auraT <= 0) {
    rig.auraGlow.visible = false;
    rig.auraRing.visible = false;
    return;
  }
  const alpha = rig.ultimate.phase === 'afterglow'
    ? Math.min(0.3, (rig.ultimate.auraT / 5000) * 0.3)
    : rig.ultimate.phase === 'explode' ? 0.4 : 0.2;
  rig.auraGlow.visible = true;
  rig.auraGlow.ellipse(0, 0, 160, 120).fill({ color: rig.lightHex, alpha });
  if (rig.ultimate.auraT > 0 || rig.ultimate.phase === 'afterglow') {
    rig.auraRing.visible = true;
    rig.auraRing.rotation += 0.015;
  }
}

/* ===============================
   VFX SPAWNERS
   =============================== */

function spawnParticles(
  rig: StageRig,
  count: number,
  color: number,
  type: 'sparkle' | 'star' | 'confetti' | 'ring' = 'sparkle',
  opts?: { speedMin?: number; speedMax?: number; ttlMin?: number; ttlMax?: number; sizeMin?: number; sizeMax?: number },
): void {
  const sm = opts?.speedMin ?? 2.8;
  const sx = opts?.speedMax ?? 6.1;
  const tm = opts?.ttlMin ?? 600;
  const tx = opts?.ttlMax ?? 1000;
  const rm = opts?.sizeMin ?? 2;
  const rx = opts?.sizeMax ?? 6;

  for (let i = 0; i < count; i++) {
    const p = new Graphics();
    const r = rm + Math.random() * (rx - rm);
    if (type === 'star') {
      p.star(0, 0, 4, r, r * 0.4).fill({ color, alpha: 0.9 });
    } else if (type === 'confetti') {
      const w = 3 + Math.random() * 4;
      const h = 2 + Math.random() * 3;
      p.rect(-w / 2, -h / 2, w, h).fill({ color, alpha: 0.85 });
      p.rotation = Math.random() * Math.PI * 2;
    } else if (type === 'ring') {
      p.circle(0, 0, r).stroke({ color, width: 2, alpha: 0.7 });
    } else {
      p.circle(0, 0, r).fill({ color, alpha: 0.9 });
    }
    p.position.set(rig.currentX, rig.currentY);
    rig.root.addChild(p);
    const angle = Math.random() * Math.PI * 2;
    const speed = sm + Math.random() * (sx - sm);
    rig.particles.push({
      g: p,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.8,
      ttl: tm + Math.random() * (tx - tm),
      age: 0,
      type,
    });
  }
}

/* ===============================
   COMPONENT
   =============================== */

export const PixiSlimeStage = forwardRef<PixiSlimeStageHandle, PixiSlimeStageProps>(
  function PixiSlimeStage({ slime, onInteract }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rigRef = useRef<StageRig | null>(null);
    const moodRef = useRef<string>('Chill');

    useImperativeHandle(ref, () => ({
      poke: () => doAction('poke'),
      squish: () => doAction('squish'),
      stretch: () => doAction('stretch'),
      bounce: () => bounceEffect(),
      megaMorph: () => megaEffect(),
      burst: (count = 8) => spawnBurst(count),
      setMood: (mood: string) => { moodRef.current = mood; },
    }));

    useEffect(() => {
      let ignore = false;
      let mountedApp: Application | null = null;
      let resizeObserver: ResizeObserver | null = null;

      async function mount(): Promise<void> {
        if (!hostRef.current || !slime) return;

        const width = clamp(Math.round(hostRef.current.clientWidth || MAX_STAGE_WIDTH), 280, MAX_STAGE_WIDTH);
        const height = clamp(Math.round(width * STAGE_ASPECT), 250, 390);

        const app = new Application();
        await app.init({
          width, height,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
          autoDensity: true,
        });

        if (ignore || !hostRef.current) { app.destroy(true); return; }
        mountedApp = app;
        hostRef.current.innerHTML = '';
        hostRef.current.appendChild(app.canvas as HTMLCanvasElement);

        const personality = getPersonality(slime.id ?? slime.name);
        const root = new Container();
        app.stage.addChild(root);

        const centerX = width * 0.5;
        const centerY = height * 0.58;

        // Ground shadow
        const groundShadow = new Graphics();
        groundShadow.ellipse(0, 0, 92, 26).fill({ color: 0x000000, alpha: 0.22 });
        groundShadow.filters = [new BlurFilter({ strength: 6 })];
        groundShadow.position.set(centerX, centerY + 95);
        root.addChild(groundShadow);

        // Aura glow (behind slime)
        const auraGlow = new Graphics();
        auraGlow.visible = false;
        auraGlow.position.set(centerX, centerY);
        root.addChild(auraGlow);

        // Aura ring
        const auraRing = new Container();
        auraRing.visible = false;
        for (let i = 0; i < 8; i++) {
          const dot = new Graphics();
          const angle = (i / 8) * Math.PI * 2;
          dot.circle(0, 0, 3).fill({ color: 0xffeaa7, alpha: 0.6 });
          dot.position.set(Math.cos(angle) * 140, Math.sin(angle) * 105);
          auraRing.addChild(dot);
        }

        // Slime container
        const slimeContainer = new Container();
        slimeContainer.position.set(centerX, centerY);
        root.addChild(slimeContainer);
        slimeContainer.addChild(auraRing);

        const bodyFill = new Graphics();
        const bodyRim = new Graphics();
        const bodyDepth = new Graphics();
        const sheen = new Graphics();
        slimeContainer.addChild(bodyFill, bodyRim, bodyDepth, sheen);

        // Cheeks
        const leftCheek = new Graphics();
        const rightCheek = new Graphics();
        slimeContainer.addChild(leftCheek, rightCheek);

        // Eyes
        const leftEyeWhite = new Graphics();
        const rightEyeWhite = new Graphics();
        slimeContainer.addChild(leftEyeWhite, rightEyeWhite);

        const leftPupil = new Graphics();
        leftPupil.position.set(-34, -15);
        const rightPupil = new Graphics();
        rightPupil.position.set(34, -15);
        slimeContainer.addChild(leftPupil, rightPupil);

        // Brows
        const leftBrow = new Graphics();
        const rightBrow = new Graphics();
        slimeContainer.addChild(leftBrow, rightBrow);

        // Mouth
        const mouth = new Graphics();
        mouth.position.set(0, 22);
        slimeContainer.addChild(mouth);

        // Sparkles
        const sparkleContainer = new Container();
        slimeContainer.addChild(sparkleContainer);
        const sparkle = findSparkle(slime.sparkle);
        if (sparkle && sparkle.id !== 'none') {
          for (let i = 0; i < 10; i++) {
            const dot = new Graphics();
            const size = 2 + Math.random() * 3;
            dot.circle(0, 0, size).fill({ color: hexToNumber(sparkle.color ?? '#dfe6e9'), alpha: 0.7 });
            dot.position.set(-68 + Math.random() * 136, -48 + Math.random() * 82);
            sparkleContainer.addChild(dot);
          }
        }

        // Charm
        const charm = findCharm(slime.charm);
        if (charm && charm.id !== 'none') {
          const charmText = new Text({
            text: charm.emoji,
            style: { fontSize: 30, fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif' },
          });
          charmText.anchor.set(0.5);
          charmText.position.set(64, -60);
          slimeContainer.addChild(charmText);
        }

        // VFX container
        const vfxContainer = new Container();
        root.addChild(vfxContainer);

        app.stage.eventMode = 'static';
        app.stage.hitArea = new Rectangle(0, 0, width, height);
        slimeContainer.eventMode = 'static';
        slimeContainer.cursor = 'grab';

        const rig: StageRig = {
          app, width, height, root,
          slime: slimeContainer, vfxContainer, groundShadow,
          bodyFill, bodyRim, bodyDepth, sheen,
          leftEyeWhite, rightEyeWhite, leftPupil, rightPupil,
          leftBrow, rightBrow, leftCheek, rightCheek,
          mouth, sparkleContainer, auraGlow, auraRing,
          particles: [],
          centerX, centerY,
          targetX: centerX, targetY: centerY,
          currentX: centerX, currentY: centerY,
          targetScaleX: 1, targetScaleY: 1,
          currentScaleX: 1, currentScaleY: 1,
          isDragging: false, dragOffsetX: 0, dragOffsetY: 0,
          wobblePhase: Math.random() * Math.PI * 2,
          colorHex: hexToNumber(slime.color),
          lightHex: lightenHex(slime.color, 46),
          darkHex: darkenHex(slime.color, 42),
          personality,
          action: { ...noAction },
          ultimate: { active: false, phase: 'idle', t: 0, auraT: 0 },
          expression: {
            blinkProgress: 0, blinkTimer: personality.blinkInterval,
            isBlinking: false, currentExpression: 'calm',
          },
          shake: createShake(0),
          megaText: null,
        };
        rigRef.current = rig;

        // Initial draw
        drawBody(rig, 0.035);
        drawEyes(rig);
        drawMouthShape(rig.mouth, rig.personality, 'calm', false);
        drawBrows(rig);
        drawCheeks(rig);

        /* ---- Events ---- */

        const setPupilLook = (x: number, y: number): void => {
          const dx = clamp((x - rig.currentX) * 0.05, -4, 4);
          const dy = clamp((y - rig.currentY) * 0.05, -4, 4);
          rig.leftPupil.position.set(-34 + dx, -15 + dy);
          rig.rightPupil.position.set(34 + dx, -15 + dy);
        };

        const onPointerDown = (event: FederatedPointerEvent): void => {
          rig.isDragging = true;
          const { x, y } = event.global;
          rig.dragOffsetX = x - rig.targetX;
          rig.dragOffsetY = y - rig.targetY;
          rig.targetScaleX = 1.08;
          rig.targetScaleY = 0.92;
          spawnBurst(3);
          onInteract?.('drag');
        };

        const onPointerMove = (event: FederatedPointerEvent): void => {
          const { x, y } = event.global;
          setPupilLook(x, y);
          if (!rig.isDragging) return;
          rig.targetX = clamp(x - rig.dragOffsetX, 90, rig.width - 90);
          rig.targetY = clamp(y - rig.dragOffsetY, 90, rig.height - 70);
          const dx = rig.targetX - rig.centerX;
          const dy = rig.targetY - rig.centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const stretchAmt = clamp(1 + dist / 340, 1, 1.45);
          const squishAmt = clamp(1 - dist / 620, 0.76, 1);
          const horiz = Math.abs(dx) > Math.abs(dy);
          rig.targetScaleX = horiz ? stretchAmt : squishAmt;
          rig.targetScaleY = horiz ? squishAmt : stretchAmt;
        };

        const onPointerUp = (): void => {
          if (!rig.isDragging) return;
          rig.isDragging = false;
          rig.targetX = rig.centerX;
          rig.targetY = rig.centerY;
          rig.targetScaleX = 1;
          rig.targetScaleY = 1;
          drawMouthShape(rig.mouth, rig.personality, rig.expression.currentExpression, true);
          setTimeout(() => {
            const r = rigRef.current;
            if (r) drawMouthShape(r.mouth, r.personality, r.expression.currentExpression, false);
          }, 300);
          onInteract?.('drag');
        };

        slimeContainer.on('pointerdown', onPointerDown);
        app.stage.on('pointermove', onPointerMove);
        app.stage.on('pointerup', onPointerUp);
        app.stage.on('pointerupoutside', onPointerUp);

        /* ---- Main loop ---- */

        app.ticker.add((ticker) => {
          if (!rigRef.current) return;
          const dt = ticker.deltaMS;
          const step = dt / 16.666;

          rig.wobblePhase += 0.05 * step * rig.personality.wobbleSpeed;

          rig.currentX += (rig.targetX - rig.currentX) * 0.2 * step;
          rig.currentY += (rig.targetY - rig.currentY) * 0.2 * step;
          rig.currentScaleX += (rig.targetScaleX - rig.currentScaleX) * 0.2 * step;
          rig.currentScaleY += (rig.targetScaleY - rig.currentScaleY) * 0.2 * step;

          const breathing = 1 + Math.sin(rig.wobblePhase) * 0.02;

          updateShake(rig.shake);
          rig.slime.position.set(rig.currentX + rig.shake.offsetX, rig.currentY + rig.shake.offsetY);
          rig.slime.scale.set(rig.currentScaleX * breathing, rig.currentScaleY / breathing);

          const wobbleStrength = rig.isDragging
            ? 0.065
            : (rig.ultimate.auraT > 0 ? 0.05 : 0.032) + Math.sin(rig.wobblePhase * 1.4) * 0.008;
          drawBody(rig, wobbleStrength);

          // Shadow
          const shadowScaleX = clamp(1 + (rig.currentScaleX - 1) * 0.28, 0.75, 1.45);
          const shadowScaleY = clamp(1 + (1 - rig.currentScaleY) * 0.4, 0.7, 1.35);
          rig.groundShadow.position.set(rig.currentX + rig.shake.offsetX, rig.currentY + 95 + rig.shake.offsetY);
          rig.groundShadow.scale.set(shadowScaleX, shadowScaleY);
          rig.groundShadow.alpha = 0.18 + Math.min(0.18, Math.abs(rig.currentY - rig.centerY) / 240);

          // Sparkle pulse
          rig.sparkleContainer.children.forEach((child, idx) => {
            child.alpha = 0.42 + Math.sin(rig.wobblePhase * 1.6 + idx) * 0.3;
          });

          // ---- Blink ----
          rig.expression.blinkTimer -= dt;
          if (rig.expression.blinkTimer <= 0 && !rig.expression.isBlinking) {
            rig.expression.isBlinking = true;
            rig.expression.blinkProgress = 0;
          }
          if (rig.expression.isBlinking) {
            rig.expression.blinkProgress += dt / 120;
            if (rig.expression.blinkProgress >= 2) {
              rig.expression.isBlinking = false;
              rig.expression.blinkProgress = 0;
              rig.expression.blinkTimer = rig.personality.blinkInterval + rand(-800, 800);
            } else if (rig.expression.blinkProgress > 1) {
              rig.expression.blinkProgress = 2 - rig.expression.blinkProgress;
            }
          }
          drawEyes(rig);

          // ---- Expression from mood ----
          const newExpr = moodToExpression(moodRef.current);
          if (newExpr !== rig.expression.currentExpression) {
            rig.expression.currentExpression = newExpr;
            drawMouthShape(rig.mouth, rig.personality, newExpr, false);
            drawBrows(rig);
            drawCheeks(rig);
            const sc = slime ? findSparkle(slime.sparkle) : undefined;
            spawnParticles(rig, 4, sc?.color ? hexToNumber(sc.color) : rig.lightHex, 'sparkle', { speedMin: 1, speedMax: 3, ttlMin: 400, ttlMax: 600, sizeMin: 2, sizeMax: 4 });
          }

          // ---- Action timer ----
          if (rig.action.kind) {
            rig.action.t += dt;
            if (rig.action.t >= rig.action.duration) rig.action.kind = null;
          }

          // ---- Ultimate phases ----
          if (rig.ultimate.active) {
            rig.ultimate.t += dt;
            const ult = rig.ultimate;
            if (ult.phase === 'charge' && ult.t >= 600) {
              ult.phase = 'explode';
              ult.t = 0;
              rig.targetScaleX = 1.5;
              rig.targetScaleY = 0.55;
              rig.shake = createShake(6);
              playSfx('ultimate');
              spawnParticles(rig, 20, 0xffeaa7, 'confetti', { speedMin: 3, speedMax: 8, ttlMin: 800, ttlMax: 1400 });
              spawnParticles(rig, 12, 0xf093fb, 'star', { speedMin: 2, speedMax: 6, ttlMin: 600, ttlMax: 1000 });
              spawnParticles(rig, 8, rig.lightHex, 'ring', { speedMin: 1, speedMax: 4, ttlMin: 500, ttlMax: 800, sizeMin: 8, sizeMax: 16 });
              if (!rig.megaText) {
                const mt = new Text({
                  text: 'MEGA SLIME!!',
                  style: { fontSize: 36, fontFamily: 'Fredoka, sans-serif', fontWeight: '700', fill: 0xffeaa7, dropShadow: { color: 0x000000, alpha: 0.4, blur: 8, distance: 3 } },
                });
                mt.anchor.set(0.5);
                mt.position.set(rig.centerX, rig.centerY - 130);
                rig.root.addChild(mt);
                rig.megaText = mt;
              }
            } else if (ult.phase === 'explode' && ult.t >= 400) {
              ult.phase = 'afterglow';
              ult.t = 0;
              ult.auraT = 8000;
              ult.active = false;
              rig.targetScaleX = 1;
              rig.targetScaleY = 1;
              if (rig.megaText) {
                const mt = rig.megaText;
                setTimeout(() => { mt.destroy(); if (rigRef.current) rigRef.current.megaText = null; }, 1200);
              }
            } else if (ult.phase === 'charge') {
              const cp = ult.t / 600;
              rig.targetScaleX = lerp(1, 0.85, cp);
              rig.targetScaleY = lerp(1, 1.1, cp);
              if (Math.random() < 0.15 * step) {
                spawnParticles(rig, 1, 0xffeaa7, 'sparkle', { speedMin: 0.5, speedMax: 2, ttlMin: 300, ttlMax: 500 });
              }
            }
          }

          // Aura decay
          if (rig.ultimate.auraT > 0) {
            rig.ultimate.auraT -= dt;
            if (rig.ultimate.auraT <= 0) { rig.ultimate.auraT = 0; rig.ultimate.phase = 'idle'; }
            if (Math.random() < 0.04 * step) {
              spawnParticles(rig, 1, 0xffeaa7, 'sparkle', { speedMin: 0.3, speedMax: 1.5, ttlMin: 400, ttlMax: 700 });
            }
          }

          drawAura(rig);

          // Mega text float
          if (rig.megaText) {
            rig.megaText.scale.set(1 + Math.sin(rig.wobblePhase * 3) * 0.04);
            rig.megaText.alpha = Math.min(1, rig.megaText.alpha + 0.05);
          }

          // ---- Particles ----
          for (let i = rig.particles.length - 1; i >= 0; i--) {
            const particle = rig.particles[i];
            particle.age += dt;
            const progress = particle.age / particle.ttl;
            particle.g.x += particle.vx * step;
            particle.g.y += particle.vy * step;
            particle.vy += 0.11 * step;
            particle.g.alpha = Math.max(0, 1 - progress);
            particle.g.scale.set(Math.max(0.18, 1 - progress * 0.9));
            if (particle.type === 'confetti') particle.g.rotation += 0.1 * step;
            if (progress >= 1) { particle.g.destroy(); rig.particles.splice(i, 1); }
          }
        });

        // Resize observer
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || !rigRef.current) return;
          const nw = clamp(Math.round(entry.contentRect.width || MAX_STAGE_WIDTH), 280, MAX_STAGE_WIDTH);
          const nh = clamp(Math.round(nw * STAGE_ASPECT), 250, 390);
          if (nw === rig.width && nh === rig.height) return;
          rig.width = nw;
          rig.height = nh;
          rig.centerX = nw * 0.5;
          rig.centerY = nh * 0.58;
          rig.targetX = rig.centerX;
          rig.targetY = rig.centerY;
          rig.currentX = rig.centerX;
          rig.currentY = rig.centerY;
          app.renderer.resize(nw, nh);
          app.stage.hitArea = new Rectangle(0, 0, nw, nh);
          rig.slime.position.set(rig.centerX, rig.centerY);
          rig.groundShadow.position.set(rig.centerX, rig.centerY + 95);
          rig.auraGlow.position.set(rig.centerX, rig.centerY);
        });
        resizeObserver.observe(hostRef.current);
      }

      mount().catch((error) => console.error('Pixi stage mount failed:', error));
      return () => {
        ignore = true;
        resizeObserver?.disconnect();
        rigRef.current = null;
        if (mountedApp) mountedApp.destroy(true);
      };
    }, [slime, onInteract]);

    /* ---- Imperative methods ---- */

    function spawnBurst(count = 8): void {
      const rig = rigRef.current;
      if (!rig) return;
      const sparkleItem = slime ? findSparkle(slime.sparkle) : undefined;
      const color = sparkleItem?.color ? hexToNumber(sparkleItem.color) : slime ? lightenHex(slime.color, 30) : 0xffffff;
      const mult = rig.ultimate.auraT > 0 ? 2 : 1;
      spawnParticles(rig, count * mult, color);
    }

    function doAction(kind: InteractionKind): void {
      const rig = rigRef.current;
      if (!rig) return;
      playSfx(kind as 'poke' | 'squish' | 'stretch' | 'bounce');
      rig.action = {
        kind, t: 0,
        duration: kind === 'poke' ? 500 : kind === 'squish' ? 600 : 550,
        intensity: rig.personality.bounciness,
        dirX: kind === 'stretch' ? (Math.random() > 0.5 ? 1 : -1) : 0,
        dirY: kind === 'stretch' ? -0.5 : 0,
      };
      switch (kind) {
        case 'poke': rig.targetScaleX = 0.82; rig.targetScaleY = 1.16; break;
        case 'squish': rig.targetScaleX = 1.34; rig.targetScaleY = 0.68; break;
        case 'stretch': rig.targetScaleX = 0.74; rig.targetScaleY = 1.28; break;
      }
      const isHappy = kind === 'squish' || kind === 'poke';
      drawMouthShape(rig.mouth, rig.personality, rig.expression.currentExpression, isHappy);
      spawnBurst(rig.ultimate.auraT > 0 ? 10 : 6);
      onInteract?.(kind);
      window.setTimeout(() => {
        const r = rigRef.current;
        if (!r || r.isDragging) return;
        r.targetScaleX = 1;
        r.targetScaleY = 1;
        drawMouthShape(r.mouth, r.personality, r.expression.currentExpression, false);
      }, 250);
    }

    function bounceEffect(): void {
      const rig = rigRef.current;
      if (!rig) return;
      playSfx('bounce');
      rig.action = { kind: 'bounce', t: 0, duration: 700, intensity: rig.personality.bounciness, dirX: 0, dirY: -1 };
      rig.targetY = rig.centerY - 80 * rig.personality.bounciness;
      rig.targetScaleX = 0.88;
      rig.targetScaleY = 1.2;
      spawnBurst(7);
      onInteract?.('bounce');
      setTimeout(() => {
        const r = rigRef.current;
        if (!r) return;
        r.targetY = r.centerY;
        r.targetScaleX = 1.18;
        r.targetScaleY = 0.82;
        r.shake = createShake(3);
        drawMouthShape(r.mouth, r.personality, r.expression.currentExpression, true);
        setTimeout(() => {
          const f = rigRef.current;
          if (!f || f.isDragging) return;
          f.targetScaleX = 1;
          f.targetScaleY = 1;
          drawMouthShape(f.mouth, f.personality, f.expression.currentExpression, false);
        }, 180);
      }, 200);
    }

    function megaEffect(): void {
      const rig = rigRef.current;
      if (!rig) return;
      rig.ultimate = { active: true, phase: 'charge', t: 0, auraT: 0 };
      rig.action = { kind: 'mega', t: 0, duration: 1500, intensity: 1.5, dirX: 0, dirY: 0 };
      drawMouthShape(rig.mouth, rig.personality, 'excited', true);
      onInteract?.('mega');
    }

    return <div className="pixi-host" ref={hostRef} />;
  },
);
