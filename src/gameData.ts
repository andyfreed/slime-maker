import type { CareAction, CareActionConfig, CharmItem, ClothingItem, ColorItem, EyeStyleItem, PlayMood, SlimeCareState, SparkleItem } from './types';

export const STARTER_COLORS = ['#55efc4', '#74b9ff', '#a29bfe', '#fd79a8', '#ffeaa7'];
export const STARTER_SPARKLES = ['none'];
export const STARTER_CHARMS = ['none'];
export const STARTER_EYES = ['normal'];
export const STARTER_CLOTHING = ['none'];

export const ALL_COLORS: ColorItem[] = [
  { id: '#55efc4', name: 'Mint', price: 0 },
  { id: '#74b9ff', name: 'Sky Blue', price: 0 },
  { id: '#a29bfe', name: 'Lavender', price: 0 },
  { id: '#fd79a8', name: 'Pink', price: 0 },
  { id: '#ffeaa7', name: 'Lemon', price: 0 },
  { id: '#ff7675', name: 'Coral', price: 20 },
  { id: '#e17055', name: 'Sunset', price: 20 },
  { id: '#00cec9', name: 'Teal', price: 25 },
  { id: '#fdcb6e', name: 'Gold', price: 25 },
  { id: '#e84393', name: 'Hot Pink', price: 30 },
  { id: '#6c5ce7', name: 'Purple', price: 30 },
  { id: '#d63031', name: 'Red', price: 30 },
  { id: '#2d3436', name: 'Shadow', price: 40 },
  { id: '#fab1a0', name: 'Peach', price: 25 },
  { id: '#81ecec', name: 'Ice', price: 20 },
];

export const ALL_SPARKLES: SparkleItem[] = [
  { id: 'none', name: 'None', price: 0, emoji: '' },
  { id: 'stars', name: 'Stars', price: 15, emoji: '⭐', color: '#ffeaa7' },
  { id: 'hearts', name: 'Hearts', price: 20, emoji: '💖', color: '#ff6b81' },
  { id: 'rainbow', name: 'Rainbow', price: 25, emoji: '🌈', color: '#a29bfe' },
  { id: 'snowflakes', name: 'Snowflakes', price: 20, emoji: '❄️', color: '#dfe6e9' },
  { id: 'diamonds', name: 'Diamonds', price: 30, emoji: '💎', color: '#74b9ff' },
];

export const ALL_CHARMS: CharmItem[] = [
  { id: 'none', name: 'None', price: 0, emoji: '' },
  { id: 'bow', name: 'Bow', price: 20, emoji: '🎀' },
  { id: 'crown', name: 'Crown', price: 30, emoji: '👑' },
  { id: 'flower', name: 'Flower', price: 15, emoji: '🌸' },
  { id: 'star', name: 'Star', price: 20, emoji: '⭐' },
  { id: 'butterfly', name: 'Butterfly', price: 25, emoji: '🦋' },
  { id: 'heart', name: 'Heart', price: 15, emoji: '💜' },
  { id: 'unicorn', name: 'Unicorn', price: 40, emoji: '🦄' },
];

export const ALL_EYES: EyeStyleItem[] = [
  { id: 'normal', name: 'Normal', price: 0, emoji: '👀' },
  { id: 'googly', name: 'Googly', price: 15, emoji: '🤪' },
  { id: 'cyclops', name: 'Cyclops', price: 20, emoji: '🔮' },
  { id: 'alien', name: 'Alien', price: 25, emoji: '👽' },
  { id: 'heart', name: 'Heart Eyes', price: 20, emoji: '😍' },
  { id: 'sleepy', name: 'Sleepy', price: 15, emoji: '😴' },
  { id: 'angry', name: 'Angry', price: 20, emoji: '😠' },
  { id: 'xeyes', name: 'X Eyes', price: 25, emoji: '😵' },
  { id: 'star', name: 'Star Eyes', price: 30, emoji: '🤩' },
  { id: 'dizzy', name: 'Dizzy', price: 20, emoji: '😵‍💫' },
];

export const ALL_CLOTHING: ClothingItem[] = [
  { id: 'none', name: 'None', price: 0, emoji: '', slot: 'hat' },
  { id: 'tophat', name: 'Top Hat', price: 25, emoji: '🎩', slot: 'hat' },
  { id: 'cowboy', name: 'Cowboy Hat', price: 30, emoji: '🤠', slot: 'hat' },
  { id: 'partyhat', name: 'Party Hat', price: 20, emoji: '🥳', slot: 'hat' },
  { id: 'beanie', name: 'Beanie', price: 15, emoji: '🧶', slot: 'hat' },
  { id: 'sunglasses', name: 'Sunglasses', price: 20, emoji: '😎', slot: 'face' },
  { id: 'monocle', name: 'Monocle', price: 30, emoji: '🧐', slot: 'face' },
  { id: 'bowtie', name: 'Bow Tie', price: 15, emoji: '🎀', slot: 'neck' },
  { id: 'scarf', name: 'Scarf', price: 20, emoji: '🧣', slot: 'neck' },
  { id: 'cape', name: 'Cape', price: 35, emoji: '🦸', slot: 'body' },
  { id: 'tutu', name: 'Tutu', price: 25, emoji: '🩰', slot: 'body' },
];

export function findSparkle(id: string): SparkleItem | undefined {
  return ALL_SPARKLES.find((item) => item.id === id);
}

export function findCharm(id: string): CharmItem | undefined {
  return ALL_CHARMS.find((item) => item.id === id);
}

export function findEyeStyle(id: string): EyeStyleItem | undefined {
  return ALL_EYES.find((item) => item.id === id);
}

export function findClothing(id: string): ClothingItem | undefined {
  return ALL_CLOTHING.find((item) => item.id === id);
}

export function computePlayMood(energy: number): PlayMood {
  if (energy >= 100) return 'Legendary';
  if (energy >= 75) return 'Hyper';
  if (energy >= 45) return 'Playful';
  if (energy >= 20) return 'Happy';
  return 'Chill';
}

export const CARE_ACTIONS: CareActionConfig[] = [
  { id: 'feed', name: 'Feed', emoji: '🍎', gain: 15, cooldownMs: 10_000 },
  { id: 'pet', name: 'Pet', emoji: '💝', gain: 10, cooldownMs: 5_000 },
  { id: 'clean', name: 'Clean', emoji: '🛁', gain: 20, cooldownMs: 15_000 },
  { id: 'play', name: 'Play', emoji: '🎾', gain: 12, cooldownMs: 8_000 },
];

export const LEVEL_THRESHOLDS = [0, 50, 100, 175, 275, 400, 550, 750, 1000, 1300];

export function carePointsForLevel(level: number): number {
  if (level <= 0) return 0;
  if (level - 1 < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[level - 1];
  const last = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const extra = level - LEVEL_THRESHOLDS.length;
  return last + extra * 400;
}

export function getLevelProgress(state: SlimeCareState): { current: number; needed: number; percent: number } {
  const current = state.carePoints;
  const needed = carePointsForLevel(state.level);
  if (needed <= 0) return { current: 0, needed: 1, percent: 100 };
  return { current, needed, percent: Math.min(100, (current / needed) * 100) };
}

export function canPerformCareAction(action: CareAction, state: SlimeCareState): boolean {
  const config = CARE_ACTIONS.find((a) => a.id === action);
  if (!config) return false;
  const lastTime = action === 'feed' ? state.lastFeed
    : action === 'pet' ? state.lastPet
    : action === 'clean' ? state.lastClean
    : state.lastPlay;
  return Date.now() - lastTime >= config.cooldownMs;
}

export function getCooldownRemaining(action: CareAction, state: SlimeCareState): number {
  const config = CARE_ACTIONS.find((a) => a.id === action);
  if (!config) return 0;
  const lastTime = action === 'feed' ? state.lastFeed
    : action === 'pet' ? state.lastPet
    : action === 'clean' ? state.lastClean
    : state.lastPlay;
  return Math.max(0, config.cooldownMs - (Date.now() - lastTime));
}

export function defaultCareState(): SlimeCareState {
  return { level: 1, carePoints: 0, lastFeed: 0, lastPet: 0, lastClean: 0, lastPlay: 0 };
}

export const LEVEL_NAMES: Record<number, string> = {
  1: 'Baby Blob',
  2: 'Little Slime',
  3: 'Bouncy Buddy',
  4: 'Gooey Pal',
  5: 'Slime Star',
  6: 'Mega Slime',
  7: 'Ultra Slime',
  8: 'Legendary Blob',
  9: 'Cosmic Slime',
  10: 'Galactic Overlord',
};

export function getLevelName(level: number): string {
  return LEVEL_NAMES[level] ?? `Level ${level} Slime`;
}
