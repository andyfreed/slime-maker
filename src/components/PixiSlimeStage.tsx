import {
  Application,
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
  root: Container;
  slime: Container;
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
}

const STAGE_WIDTH = 500;
const STAGE_HEIGHT = 360;

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

function drawMouth(mouth: Graphics, happy: boolean): void {
  mouth.clear();
  const y = happy ? 14 : 8;
  const width = happy ? 26 : 20;
  mouth.moveTo(-width, 0);
  mouth.bezierCurveTo(-width * 0.55, y, width * 0.55, y, width, 0);
  mouth.stroke({ color: 0x2d3436, width: 4, cap: 'round', join: 'round' });
}

function createSlimeBody(color: string): Container {
  const group = new Container();

  const base = new Graphics();
  base.ellipse(0, 0, 118, 92).fill({ color: hexToNumber(color) });
  base.stroke({ color: lightenHex(color, 38), width: 3, alpha: 0.55 });
  group.addChild(base);

  const sheen = new Graphics();
  sheen.ellipse(-20, -35, 62, 28).fill({ color: 0xffffff, alpha: 0.26 });
  group.addChild(sheen);

  const depth = new Graphics();
  depth.ellipse(0, 34, 80, 20).fill({ color: 0x000000, alpha: 0.12 });
  group.addChild(depth);

  const leftEye = new Graphics();
  leftEye.ellipse(-34, -20, 12, 17).fill({ color: 0xffffff });
  group.addChild(leftEye);

  const rightEye = new Graphics();
  rightEye.ellipse(34, -20, 12, 17).fill({ color: 0xffffff });
  group.addChild(rightEye);

  return group;
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

      async function mount(): Promise<void> {
        if (!hostRef.current || !slime) return;

        const app = new Application();
        await app.init({
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
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

        const centerX = STAGE_WIDTH * 0.5;
        const centerY = STAGE_HEIGHT * 0.56;

        const slimeContainer = new Container();
        slimeContainer.position.set(centerX, centerY);
        root.addChild(slimeContainer);

        const bodyGroup = createSlimeBody(slime.color);
        slimeContainer.addChild(bodyGroup);

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
          for (let i = 0; i < 9; i += 1) {
            const dot = new Graphics();
            const size = 2 + Math.random() * 3;
            dot.circle(0, 0, size).fill({ color: hexToNumber(sparkle.color ?? '#dfe6e9'), alpha: 0.65 });
            dot.position.set(-65 + Math.random() * 130, -45 + Math.random() * 70);
            sparkleContainer.addChild(dot);
          }
        }

        const charm = findCharm(slime.charm);
        if (charm && charm.id !== 'none') {
          const charmText = new Text({
            text: charm.emoji,
            style: { fontSize: 30 },
          });
          charmText.anchor.set(0.5);
          charmText.position.set(64, -60);
          slimeContainer.addChild(charmText);
        }

        app.stage.eventMode = 'static';
        app.stage.hitArea = new Rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        slimeContainer.eventMode = 'static';
        slimeContainer.cursor = 'grab';

        const rig: StageRig = {
          app,
          root,
          slime: slimeContainer,
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
        };
        rigRef.current = rig;

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
          rig.targetX = clamp(x - rig.dragOffsetX, 90, STAGE_WIDTH - 90);
          rig.targetY = clamp(y - rig.dragOffsetY, 90, STAGE_HEIGHT - 70);

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
          rig.wobblePhase += 0.04 * step;

          rig.currentX += (rig.targetX - rig.currentX) * 0.2 * step;
          rig.currentY += (rig.targetY - rig.currentY) * 0.2 * step;
          rig.currentScaleX += (rig.targetScaleX - rig.currentScaleX) * 0.2 * step;
          rig.currentScaleY += (rig.targetScaleY - rig.currentScaleY) * 0.2 * step;

          const breathing = 1 + Math.sin(rig.wobblePhase) * 0.02;
          rig.slime.position.set(rig.currentX, rig.currentY);
          rig.slime.scale.set(rig.currentScaleX * breathing, rig.currentScaleY / breathing);

          rig.sparkleContainer.children.forEach((child, index) => {
            child.alpha = 0.4 + Math.sin(rig.wobblePhase * 1.6 + index) * 0.28;
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
      }

      mount().catch((error) => {
        console.error('Pixi stage mount failed:', error);
      });

      return () => {
        ignore = true;
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
