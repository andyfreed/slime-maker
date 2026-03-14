import type { CharmItem, ClothingItem, ColorItem, EyeStyleItem, PlayMood, SparkleItem } from './types';

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
