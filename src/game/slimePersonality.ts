/**
 * Deterministic slime personality derived from slime ID.
 * Ensures consistent look across devices/users.
 */

export type EyeStyle = 'round' | 'oval' | 'sleepy';
export type PupilSize = 'small' | 'medium' | 'large';
export type MouthStyle = 'smile' | 'grin' | 'open' | 'smirk';
export type CheekStyle = 'none' | 'blush' | 'gradient';
export type BrowStyle = 'none' | 'tiny';

export interface SlimePersonality {
  eyeStyle: EyeStyle;
  pupilSize: PupilSize;
  mouthStyle: MouthStyle;
  cheekStyle: CheekStyle;
  browStyle: BrowStyle;
  blinkInterval: number; // ms between blinks (2000-6000)
  wobbleSpeed: number;   // 0.8-1.2 multiplier
  bounciness: number;    // 0.8-1.2 multiplier
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function pick<T>(items: T[], hash: number, offset: number): T {
  const idx = ((hash >>> offset) ^ (hash >>> (offset + 7))) % items.length;
  return items[idx];
}

function range(hash: number, offset: number, min: number, max: number): number {
  const raw = ((hash >>> offset) & 0xffff) / 0xffff;
  return min + raw * (max - min);
}

export function getPersonality(slimeId: string): SlimePersonality {
  const h = hashId(slimeId);
  return {
    eyeStyle: pick(['round', 'oval', 'sleepy'], h, 0),
    pupilSize: pick(['small', 'medium', 'large'], h, 4),
    mouthStyle: pick(['smile', 'grin', 'open', 'smirk'], h, 8),
    cheekStyle: pick(['none', 'blush', 'gradient'], h, 12),
    browStyle: pick(['none', 'tiny'], h, 16),
    blinkInterval: Math.round(range(h, 20, 2000, 6000)),
    wobbleSpeed: range(h, 24, 0.85, 1.15),
    bounciness: range(h, 28, 0.85, 1.15),
  };
}

export type MoodExpression = 'calm' | 'playful' | 'tired' | 'excited';

export function moodToExpression(mood: string): MoodExpression {
  switch (mood) {
    case 'Legendary':
    case 'Hyper':
      return 'excited';
    case 'Playful':
      return 'playful';
    case 'Chill':
      return 'calm';
    default:
      return 'calm';
  }
}
