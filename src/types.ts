export interface Profile {
  id: string;
  username: string;
  coins: number;
  owned_colors: string[];
  owned_sparkles: string[];
  owned_charms: string[];
  created_at?: string;
}

export interface Slime {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sparkle: string;
  charm: string;
  created_at?: string;
  profiles?: { username: string } | null;
}

export interface ColorItem {
  id: string;
  name: string;
  price: number;
}

export interface SparkleItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
  color?: string;
}

export interface CharmItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
}

export type ShopType = 'color' | 'sparkle' | 'charm';

export type PlayMood = 'Chill' | 'Happy' | 'Playful' | 'Hyper' | 'Legendary';
