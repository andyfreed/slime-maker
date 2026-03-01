/**
 * Small VFX / juice helper functions for the slime game.
 */

/** Ease out cubic for satisfying deceleration */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease in out quad */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Elastic ease out for bouncy feels */
export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/** Spring ease for wobbly returns */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Clamp a value between min and max */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Lerp between two values */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Random float in range */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Screen shake data */
export interface ScreenShake {
  intensity: number;
  decay: number;
  offsetX: number;
  offsetY: number;
}

export function createShake(intensity: number): ScreenShake {
  return { intensity, decay: 0.92, offsetX: 0, offsetY: 0 };
}

export function updateShake(shake: ScreenShake): void {
  if (shake.intensity < 0.5) {
    shake.offsetX = 0;
    shake.offsetY = 0;
    shake.intensity = 0;
    return;
  }
  shake.offsetX = (Math.random() - 0.5) * shake.intensity * 2;
  shake.offsetY = (Math.random() - 0.5) * shake.intensity * 2;
  shake.intensity *= shake.decay;
}

/**
 * SFX interface - calls are no-ops by default since audio assets are optional.
 * Hook into this to add actual sounds.
 */
export type SfxName = 'poke' | 'squish' | 'stretch' | 'bounce' | 'ultimate' | 'pop';

export function playSfx(_name: SfxName): void {
  // Audio assets optional - this is the hook point
}
