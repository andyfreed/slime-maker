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

interface StageRig {
  app: Application;
  width: number;
  height: number;
  root: Container;
  slime: Container;
  groundShadow: Graphics;
  bodyFill: Graphics;
  bodyRim: Graphics;
  bodyDepth: Graphics;
  sheen: Graphics;
  leftPupil: Graphics;
  rightPupil: Graphics;
  mouth: Graphics;
  sparkleContainer: Container;
  particles: Array<{
    g: Graphics;
    vx: number;
    vy: number;
    ttl: number;
    age: number;
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
}

const MAX_STAGE_WIDTH = 500;
const STAGE_ASPECT = 0.72;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

function drawMouth(mouth: Graphics, happy: boolean): void {
  mouth.clear();
  const y = happy ? 14 : 8;
  const width = happy ? 26 : 20;
  mouth.moveTo(-width, 0);
  mouth.bezierCurveTo(-width * 0.55, y, width * 0.55, y, width, 0);
  mouth.stroke({ color: 0x2d3436, width: 4, cap: 'round', join: 'round' });
}

function makeBlobPoints(radiusX: number, radiusY: number, wobble: number, phase: number): number[] {
  const points: number[] = [];
  const segments = 44;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const waveA = Math.sin(angle * 3 + phase) * wobble;
    const waveB = Math.cos(angle * 5 - phase * 1.25) * wobble * 0.55;
    const wave = waveA + waveB;
    const px = Math.cos(angle) * radiusX * (1 + wave);
    const py = Math.sin(angle) * radiusY * (1 - wave * 0.45);
    points.push(px, py);
  }
  return points;
}

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
  const points = makeBlobPoints(radiusX, radiusY, wobbleStrength, rig.wobblePhase);
  const innerPoints = makeBlobPoints(radiusX * 0.9, radiusY * 0.58, wobbleStrength * 0.7, rig.wobblePhase + 0.9);

  drawBlobWithStroke(rig.bodyFill, points, rig.colorHex, rig.lightHex, 3, 0.98);
  drawBlob(rig.bodyRim, points, rig.lightHex, 0.1);
  drawBlob(rig.bodyDepth, innerPoints, rig.darkHex, 0.26);
  rig.bodyDepth.position.set(0, 35);

  rig.sheen.clear();
  rig.sheen.ellipse(-26, -40, 62, 27).fill({ color: 0xffffff, alpha: 0.28 });
  rig.sheen.ellipse(6, -30, 48, 18).fill({ color: 0xffffff, alpha: 0.1 });
  rig.sheen.rotation = Math.sin(rig.wobblePhase * 0.7) * 0.04;
}

function createPupil(x: number): Graphics {
  const pupil = new Graphics();
  pupil.circle(0, 0, 5).fill({ color: 0x2d3436 });
  pupil.position.set(x, -15);
  return pupil;
}

export const PixiSlimeStage = forwardRef<PixiSlimeStageHandle, PixiSlimeStageProps>(
  function PixiSlimeStage({ slime, onInteract }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rigRef = useRef<StageRig | null>(null);

    useImperativeHandle(ref, () => ({
      poke: () => impulse('poke', 0.82, 1.16),
      squish: () => impulse('squish', 1.34, 0.68),
      stretch: () => impulse('stretch', 0.74, 1.28),
      bounce: () => bounceEffect(),
      megaMorph: () => megaEffect(),
      burst: (count = 8) => spawnBurst(count),
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
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
          autoDensity: true,
        });

        if (ignore || !hostRef.current) {
          app.destroy(true);
          return;
        }

        mountedApp = app;
        hostRef.current.innerHTML = '';
        hostRef.current.appendChild(app.canvas as HTMLCanvasElement);

        const root = new Container();
        app.stage.addChild(root);

        const centerX = width * 0.5;
        const centerY = height * 0.58;

        const groundShadow = new Graphics();
        groundShadow.ellipse(0, 0, 92, 26).fill({ color: 0x000000, alpha: 0.22 });
        groundShadow.filters = [new BlurFilter({ strength: 6 })];
        groundShadow.position.set(centerX, centerY + 95);
        root.addChild(groundShadow);

        const slimeContainer = new Container();
        slimeContainer.position.set(centerX, centerY);
        root.addChild(slimeContainer);

        const bodyFill = new Graphics();
        const bodyRim = new Graphics();
        const bodyDepth = new Graphics();
        const sheen = new Graphics();

        slimeContainer.addChild(bodyFill);
        slimeContainer.addChild(bodyRim);
        slimeContainer.addChild(bodyDepth);
        slimeContainer.addChild(sheen);

        const leftEye = new Graphics();
        leftEye.ellipse(-34, -20, 12, 17).fill({ color: 0xffffff });
        slimeContainer.addChild(leftEye);

        const rightEye = new Graphics();
        rightEye.ellipse(34, -20, 12, 17).fill({ color: 0xffffff });
        slimeContainer.addChild(rightEye);

        const leftPupil = createPupil(-34);
        const rightPupil = createPupil(34);
        slimeContainer.addChild(leftPupil);
        slimeContainer.addChild(rightPupil);

        const mouth = new Graphics();
        mouth.position.set(0, 22);
        drawMouth(mouth, false);
        slimeContainer.addChild(mouth);

        const sparkleContainer = new Container();
        slimeContainer.addChild(sparkleContainer);

        const sparkle = findSparkle(slime.sparkle);
        if (sparkle && sparkle.id !== 'none') {
          for (let i = 0; i < 10; i += 1) {
            const dot = new Graphics();
            const size = 2 + Math.random() * 3;
            dot.circle(0, 0, size).fill({ color: hexToNumber(sparkle.color ?? '#dfe6e9'), alpha: 0.7 });
            dot.position.set(-68 + Math.random() * 136, -48 + Math.random() * 82);
            sparkleContainer.addChild(dot);
          }
        }

        const charm = findCharm(slime.charm);
        if (charm && charm.id !== 'none') {
          const charmText = new Text({
            text: charm.emoji,
            style: {
              fontSize: 30,
              fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif',
            },
          });
          charmText.anchor.set(0.5);
          charmText.position.set(64, -60);
          slimeContainer.addChild(charmText);
        }

        app.stage.eventMode = 'static';
        app.stage.hitArea = new Rectangle(0, 0, width, height);
        slimeContainer.eventMode = 'static';
        slimeContainer.cursor = 'grab';

        const rig: StageRig = {
          app,
          width,
          height,
          root,
          slime: slimeContainer,
          groundShadow,
          bodyFill,
          bodyRim,
          bodyDepth,
          sheen,
          leftPupil,
          rightPupil,
          mouth,
          sparkleContainer,
          particles: [],
          centerX,
          centerY,
          targetX: centerX,
          targetY: centerY,
          currentX: centerX,
          currentY: centerY,
          targetScaleX: 1,
          targetScaleY: 1,
          currentScaleX: 1,
          currentScaleY: 1,
          isDragging: false,
          dragOffsetX: 0,
          dragOffsetY: 0,
          wobblePhase: Math.random() * Math.PI * 2,
          colorHex: hexToNumber(slime.color),
          lightHex: lightenHex(slime.color, 46),
          darkHex: darkenHex(slime.color, 42),
        };
        rigRef.current = rig;
        drawBody(rig, 0.035);

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
          drawMouth(rig.mouth, false);
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
          const stretch = clamp(1 + dist / 340, 1, 1.45);
          const squish = clamp(1 - dist / 620, 0.76, 1);

          const horizontalFactor = Math.abs(dx) > Math.abs(dy);
          rig.targetScaleX = horizontalFactor ? stretch : squish;
          rig.targetScaleY = horizontalFactor ? squish : stretch;
        };

        const onPointerUp = (): void => {
          if (!rig.isDragging) return;
          rig.isDragging = false;
          rig.targetX = rig.centerX;
          rig.targetY = rig.centerY;
          rig.targetScaleX = 1;
          rig.targetScaleY = 1;
          drawMouth(rig.mouth, true);
          setTimeout(() => drawMouth(rig.mouth, false), 220);
          onInteract?.('drag');
        };

        slimeContainer.on('pointerdown', onPointerDown);
        app.stage.on('pointermove', onPointerMove);
        app.stage.on('pointerup', onPointerUp);
        app.stage.on('pointerupoutside', onPointerUp);

        app.ticker.add((ticker) => {
          if (!rigRef.current) return;
          const step = ticker.deltaMS / 16.666;
          rig.wobblePhase += 0.05 * step;

          rig.currentX += (rig.targetX - rig.currentX) * 0.2 * step;
          rig.currentY += (rig.targetY - rig.currentY) * 0.2 * step;
          rig.currentScaleX += (rig.targetScaleX - rig.currentScaleX) * 0.2 * step;
          rig.currentScaleY += (rig.targetScaleY - rig.currentScaleY) * 0.2 * step;

          const breathing = 1 + Math.sin(rig.wobblePhase) * 0.02;
          rig.slime.position.set(rig.currentX, rig.currentY);
          rig.slime.scale.set(rig.currentScaleX * breathing, rig.currentScaleY / breathing);

          const wobbleStrength = rig.isDragging ? 0.065 : 0.032 + Math.sin(rig.wobblePhase * 1.4) * 0.008;
          drawBody(rig, wobbleStrength);

          const shadowScaleX = clamp(1 + (rig.currentScaleX - 1) * 0.28, 0.75, 1.45);
          const shadowScaleY = clamp(1 + (1 - rig.currentScaleY) * 0.4, 0.7, 1.35);
          rig.groundShadow.position.set(rig.currentX, rig.currentY + 95);
          rig.groundShadow.scale.set(shadowScaleX, shadowScaleY);
          rig.groundShadow.alpha = 0.18 + Math.min(0.18, Math.abs(rig.currentY - rig.centerY) / 240);

          rig.sparkleContainer.children.forEach((child, index) => {
            child.alpha = 0.42 + Math.sin(rig.wobblePhase * 1.6 + index) * 0.3;
          });

          for (let i = rig.particles.length - 1; i >= 0; i -= 1) {
            const particle = rig.particles[i];
            particle.age += ticker.deltaMS;
            const progress = particle.age / particle.ttl;
            particle.g.x += particle.vx * step;
            particle.g.y += particle.vy * step;
            particle.vy += 0.11 * step;
            particle.g.alpha = Math.max(0, 1 - progress);
            particle.g.scale.set(Math.max(0.18, 1 - progress * 0.9));

            if (progress >= 1) {
              particle.g.destroy();
              rig.particles.splice(i, 1);
            }
          }
        });

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || !rigRef.current) return;
          const newWidth = clamp(Math.round(entry.contentRect.width || MAX_STAGE_WIDTH), 280, MAX_STAGE_WIDTH);
          const newHeight = clamp(Math.round(newWidth * STAGE_ASPECT), 250, 390);
          if (newWidth === rig.width && newHeight === rig.height) return;

          rig.width = newWidth;
          rig.height = newHeight;
          rig.centerX = newWidth * 0.5;
          rig.centerY = newHeight * 0.58;
          rig.targetX = rig.centerX;
          rig.targetY = rig.centerY;
          rig.currentX = rig.centerX;
          rig.currentY = rig.centerY;

          app.renderer.resize(newWidth, newHeight);
          app.stage.hitArea = new Rectangle(0, 0, newWidth, newHeight);
          rig.slime.position.set(rig.centerX, rig.centerY);
          rig.groundShadow.position.set(rig.centerX, rig.centerY + 95);
        });
        resizeObserver.observe(hostRef.current);
      }

      mount().catch((error) => {
        console.error('Pixi stage mount failed:', error);
      });

      return () => {
        ignore = true;
        resizeObserver?.disconnect();
        rigRef.current = null;
        if (mountedApp) {
          mountedApp.destroy(true);
        }
      };
    }, [slime, onInteract]);

    function spawnBurst(count = 8): void {
      const rig = rigRef.current;
      if (!rig) return;

      const sparkle = slime ? findSparkle(slime.sparkle) : undefined;
      const color = sparkle?.color ? hexToNumber(sparkle.color) : slime ? lightenHex(slime.color, 30) : 0xffffff;

      for (let i = 0; i < count; i += 1) {
        const p = new Graphics();
        const radius = 2 + Math.random() * 5;
        p.circle(0, 0, radius).fill({ color, alpha: 0.9 });
        p.position.set(rig.currentX, rig.currentY);
        rig.root.addChild(p);

        const angle = Math.random() * Math.PI * 2;
        const speed = 2.8 + Math.random() * 3.3;
        rig.particles.push({
          g: p,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.8,
          ttl: 700 + Math.random() * 350,
          age: 0,
        });
      }
    }

    function impulse(kind: InteractionKind, sx: number, sy: number): void {
      const rig = rigRef.current;
      if (!rig) return;
      rig.targetScaleX = sx;
      rig.targetScaleY = sy;
      drawMouth(rig.mouth, kind === 'bounce' || kind === 'mega');
      spawnBurst(kind === 'mega' ? 14 : 6);
      onInteract?.(kind);
      window.setTimeout(() => {
        const latest = rigRef.current;
        if (!latest || latest.isDragging) return;
        latest.targetScaleX = 1;
        latest.targetScaleY = 1;
        drawMouth(latest.mouth, false);
      }, 220);
    }

    function bounceEffect(): void {
      const rig = rigRef.current;
      if (!rig) return;
      rig.targetY = rig.centerY - 80;
      rig.targetScaleX = 0.88;
      rig.targetScaleY = 1.2;
      spawnBurst(7);
      onInteract?.('bounce');
      setTimeout(() => {
        const latest = rigRef.current;
        if (!latest) return;
        latest.targetY = latest.centerY;
        latest.targetScaleX = 1.18;
        latest.targetScaleY = 0.82;
        setTimeout(() => {
          const finalRig = rigRef.current;
          if (!finalRig || finalRig.isDragging) return;
          finalRig.targetScaleX = 1;
          finalRig.targetScaleY = 1;
        }, 140);
      }, 180);
    }

    function megaEffect(): void {
      const rig = rigRef.current;
      if (!rig) return;
      rig.targetScaleX = 1.42;
      rig.targetScaleY = 0.62;
      spawnBurst(16);
      onInteract?.('mega');
      setTimeout(() => {
        const latest = rigRef.current;
        if (!latest || latest.isDragging) return;
        latest.targetScaleX = 1;
        latest.targetScaleY = 1;
      }, 260);
    }

    return <div className="pixi-host" ref={hostRef} />;
  },
);
