import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PixiSlimeStage, type PixiSlimeStageHandle } from './components/PixiSlimeStage';
import { GameButton } from './components/ui/GameButton';
import { GlassCard } from './components/ui/GlassCard';
import { TopHUD } from './components/ui/TopHUD';
import {
  ALL_CHARMS,
  ALL_COLORS,
  ALL_SPARKLES,
  STARTER_CHARMS,
  STARTER_COLORS,
  STARTER_SPARKLES,
  computePlayMood,
  findCharm,
  findSparkle,
} from './gameData';
import { generateShareCode, formatShareCode, normalizeShareCode } from './game/share';
import { supabase } from './lib/supabase';
import type { CharmItem, PlayMood, Profile, ShopType, Slime, SparkleItem } from './types';

type Screen = 'auth' | 'home' | 'create' | 'collection' | 'friends' | 'shop' | 'play';
type InteractionKind = 'drag' | 'poke' | 'squish' | 'stretch' | 'bounce' | 'mega' | 'bubble';

interface CreateOptions {
  color: string;
  sparkle: string;
  charm: string;
  name: string;
}

interface Bubble {
  id: string;
  left: number;
  size: number;
  durationMs: number;
  type: 'normal' | 'golden' | 'tiny';
}

interface BubbleRushState {
  active: boolean;
  popped: number;
  target: number;
  endsAt: number;
  spawnTimer: number | null;
  countdownTimer: number | null;
  totalCoins: number;
}

interface PlayHud {
  energy: number;
  combo: number;
  mood: PlayMood;
  status: string;
}

interface ShareModal {
  visible: boolean;
  slimeId: string | null;
  shareCode: string | null;
  loading: boolean;
}

interface RedeemState {
  code: string;
  loading: boolean;
  result: SharedSlimeData | null;
  error: string | null;
}

interface SharedSlimeData {
  id: string;
  name: string;
  color: string;
  sparkle: string;
  charm: string;
  share_code: string;
  creator_name: string;
}

const initialPlayHud: PlayHud = {
  energy: 0,
  combo: 0,
  mood: 'Chill',
  status: 'Charge up your slime for Mega Morph!',
};

const initialBubbleRush: BubbleRushState = {
  active: false,
  popped: 0,
  target: 12,
  endsAt: 0,
  spawnTimer: null,
  countdownTimer: null,
  totalCoins: 0,
};

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ===============================
   UTILITIES
   =============================== */

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function buildKidPassword(code: string): string {
  return `slime-kid-${code}-play`;
}

function isInvalidLoginError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? '').toLowerCase();
  const code = String((error as { code?: string })?.code ?? '').toLowerCase();
  return code === 'invalid_credentials' || message.includes('invalid login');
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? '').toLowerCase();
  const code = String((error as { code?: string })?.code ?? '').toLowerCase();
  return (
    code === '23505' ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('duplicate key')
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  const message = String((error as { message?: string })?.message ?? '');
  if (!message) return fallback;
  return message;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lightenColor(hex: string, percent: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(value)) return hex;
  const r = Math.min(255, (value >> 16) + Math.round((255 * percent) / 100));
  const g = Math.min(255, ((value >> 8) & 0xff) + Math.round((255 * percent) / 100));
  const b = Math.min(255, (value & 0xff) + Math.round((255 * percent) / 100));
  return `rgb(${r}, ${g}, ${b})`;
}

function defaultProfile(id: string, username: string): Profile {
  return {
    id,
    username,
    coins: 0,
    owned_colors: [...STARTER_COLORS],
    owned_sparkles: [...STARTER_SPARKLES],
    owned_charms: [...STARTER_CHARMS],
  };
}

function sanitizeProfile(data: Partial<Profile> & { id: string; username: string }): Profile {
  return {
    id: data.id,
    username: data.username,
    coins: Number.isFinite(data.coins) ? Number(data.coins) : 0,
    owned_colors: Array.isArray(data.owned_colors) && data.owned_colors.length > 0 ? data.owned_colors : [...STARTER_COLORS],
    owned_sparkles:
      Array.isArray(data.owned_sparkles) && data.owned_sparkles.length > 0 ? data.owned_sparkles : [...STARTER_SPARKLES],
    owned_charms: Array.isArray(data.owned_charms) && data.owned_charms.length > 0 ? data.owned_charms : [...STARTER_CHARMS],
    created_at: data.created_at,
  };
}

function slimeGradient(color: string): string {
  return `radial-gradient(circle at 35% 35%, ${lightenColor(color, 28)}, ${color})`;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function seededNoise(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function makeBubbleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ===============================
   MINI SLIME (CSS preview)
   =============================== */

function MiniSlime({
  color,
  sparkle,
  charm,
  size = 'normal',
}: {
  color: string;
  sparkle: string;
  charm: string;
  size?: 'small' | 'normal';
}) {
  const sparkleData = findSparkle(sparkle);
  const charmData = findCharm(charm);
  const sparkleDots = useMemo(() => {
    if (!sparkleData || sparkleData.id === 'none') return [];
    const base = hashString(`${color}|${sparkle}|${charm}|${size}`);
    return Array.from({ length: 8 }, (_, index) => {
      const s = base + index * 131;
      return {
        left: 14 + seededNoise(s + 1) * 72,
        top: 8 + seededNoise(s + 2) * 64,
        size: 4 + seededNoise(s + 3) * 5,
        delay: seededNoise(s + 4) * 1.8,
      };
    });
  }, [charm, color, size, sparkle, sparkleData]);

  return (
    <div className={`mini-slime ${size}`} style={{ background: slimeGradient(color) }}>
      <div className="slime-shine" />
      <div className="eye left" />
      <div className="eye right" />
      <div className="mouth" />
      {sparkleDots.map((dot, index) => (
        <div
          key={`${sparkle}-${index}`}
          className="sparkle-dot"
          style={{
            left: `${dot.left}%`,
            top: `${dot.top}%`,
            width: `${dot.size}px`,
            height: `${dot.size}px`,
            background: sparkleData?.color ?? '#dfe6e9',
            animationDelay: `${dot.delay}s`,
          }}
        />
      ))}
      {charmData && charmData.id !== 'none' && <div className="charm">{charmData.emoji}</div>}
    </div>
  );
}

/* ===============================
   MAIN APP
   =============================== */

export default function App() {
  const [screen, setScreen] = useState<Screen>('auth');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [slimes, setSlimes] = useState<Slime[]>([]);
  const [friendsSlimes, setFriendsSlimes] = useState<Slime[]>([]);
  const [playSlime, setPlaySlime] = useState<Slime | null>(null);

  const [authUsername, setAuthUsername] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [createOptions, setCreateOptions] = useState<CreateOptions>({
    color: STARTER_COLORS[0],
    sparkle: 'none',
    charm: 'none',
    name: '',
  });

  const [playHud, setPlayHud] = useState<PlayHud>(initialPlayHud);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [showUltimateText, setShowUltimateText] = useState(false);

  const [loadingCollection, setLoadingCollection] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Share state
  const [shareModal, setShareModal] = useState<ShareModal>({
    visible: false,
    slimeId: null,
    shareCode: null,
    loading: false,
  });
  const [redeemState, setRedeemState] = useState<RedeemState>({
    code: '',
    loading: false,
    result: null,
    error: null,
  });

  const pixiRef = useRef<PixiSlimeStageHandle | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const energyDecayTimerRef = useRef<number | null>(null);
  const lastActionAtRef = useRef(0);
  const energyRef = useRef(0);
  const comboRef = useRef(0);
  const bubbleRushRef = useRef<BubbleRushState>({ ...initialBubbleRush });
  const isOwnPlaySlimeRef = useRef(false);
  const screenRef = useRef<Screen>('auth');

  const ownedColorSet = useMemo(() => new Set(profile?.owned_colors ?? []), [profile?.owned_colors]);
  const ownedSparkleSet = useMemo(() => new Set(profile?.owned_sparkles ?? []), [profile?.owned_sparkles]);
  const ownedCharmSet = useMemo(() => new Set(profile?.owned_charms ?? []), [profile?.owned_charms]);

  const canMegaMorph = playHud.energy >= 100;
  const bubbleRushActive = bubbleRushRef.current.active;
  const coinBalance = profile?.coins ?? 0;

  /* ---- Toast ---- */

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  /* ---- Profile persistence ---- */

  const persistProfile = useCallback(async (nextProfile: Profile) => {
    const { error } = await supabase
      .from('profiles')
      .update({
        coins: nextProfile.coins,
        owned_colors: nextProfile.owned_colors,
        owned_sparkles: nextProfile.owned_sparkles,
        owned_charms: nextProfile.owned_charms,
      })
      .eq('id', nextProfile.id);
    if (error) console.error('Failed to save profile:', error);
  }, []);

  const updateProfile = useCallback(
    (updater: (current: Profile) => Profile) => {
      setProfile((current) => {
        if (!current) return current;
        const next = updater(current);
        void persistProfile(next);
        return next;
      });
    },
    [persistProfile],
  );

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) { console.error('Failed loading profile:', error); return null; }
    if (!data) return null;
    return sanitizeProfile(data as Profile);
  }, []);

  const ensureProfileExists = useCallback(
    async (username: string): Promise<Profile> => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error('Could not verify your account.');
      const user = userData.user;
      const existing = await fetchProfile(user.id);
      if (existing) return existing;
      const defaults = defaultProfile(user.id, username);
      const { error: insertError } = await supabase.from('profiles').insert(defaults);
      if (insertError && !isAlreadyExistsError(insertError)) throw insertError;
      const created = await fetchProfile(user.id);
      if (!created) throw new Error('Could not load your profile.');
      return created;
    },
    [fetchProfile],
  );

  const loadMySlimes = useCallback(async (userId: string): Promise<Slime[]> => {
    const { data, error } = await supabase.from('slimes').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { console.error('Failed loading slimes:', error); return []; }
    return (data ?? []) as Slime[];
  }, []);

  const loadFriends = useCallback(async (userId: string): Promise<Slime[]> => {
    const { data, error } = await supabase
      .from('slimes')
      .select('*, profiles(username)')
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) { console.error('Failed loading friends slimes:', error); return []; }
    return (data ?? []) as Slime[];
  }, []);

  /* ---- Play state ---- */

  const stopEnergyDecay = useCallback(() => {
    if (!energyDecayTimerRef.current) return;
    window.clearInterval(energyDecayTimerRef.current);
    energyDecayTimerRef.current = null;
  }, []);

  const syncPlayHud = useCallback((statusOverride?: string) => {
    const energy = energyRef.current;
    const combo = comboRef.current;
    const mood = computePlayMood(energy);
    const bubbleState = bubbleRushRef.current;

    // Update pixi mood
    pixiRef.current?.setMood(mood);

    let status = statusOverride;
    if (!status) {
      if (bubbleState.active) {
        const leftMs = Math.max(0, bubbleState.endsAt - Date.now());
        const sec = Math.ceil(leftMs / 1000);
        status = `Bubble Rush: ${bubbleState.popped}/${bubbleState.target} • ${sec}s`;
      } else if (energy >= 100) {
        status = 'Mega Morph ready! Tap the gold button.';
      } else {
        status = 'Charge up your slime for Mega Morph!';
      }
    }
    setPlayHud({ energy, combo, mood, status });
  }, []);

  const registerPlayAction = useCallback(
    (kind: InteractionKind, baseGain: number) => {
      const now = Date.now();
      comboRef.current = now - lastActionAtRef.current < 1700 ? Math.min(comboRef.current + 1, 99) : 1;
      lastActionAtRef.current = now;
      const comboBonus = Math.min(12, Math.floor(comboRef.current / 3));
      energyRef.current = clamp(energyRef.current + baseGain + comboBonus, 0, 100);
      if (kind === 'drag') {
        syncPlayHud('Sliiiime stretch!');
      } else {
        syncPlayHud();
      }
    },
    [syncPlayHud],
  );

  const startEnergyDecay = useCallback(() => {
    stopEnergyDecay();
    energyDecayTimerRef.current = window.setInterval(() => {
      if (screenRef.current !== 'play') return;
      if (bubbleRushRef.current.active) return;
      if (Date.now() - lastActionAtRef.current < 1400) return;
      if (energyRef.current <= 0) return;
      energyRef.current = clamp(energyRef.current - 1, 0, 100);
      syncPlayHud();
    }, 850);
  }, [stopEnergyDecay, syncPlayHud]);

  const clearBubbleRushTimers = useCallback(() => {
    const state = bubbleRushRef.current;
    if (state.spawnTimer) { window.clearInterval(state.spawnTimer); state.spawnTimer = null; }
    if (state.countdownTimer) { window.clearInterval(state.countdownTimer); state.countdownTimer = null; }
  }, []);

  const awardCoins = useCallback(
    (amount: number, reason: string) => {
      if (amount <= 0) return;
      if (!isOwnPlaySlimeRef.current) return;
      updateProfile((current) => ({ ...current, coins: current.coins + amount }));
      showToast(`${reason} +${amount} coins!`);
    },
    [showToast, updateProfile],
  );

  const endBubbleRush = useCallback(
    (success: boolean, silent = false) => {
      const state = bubbleRushRef.current;
      if (!state.active) return;
      state.active = false;
      clearBubbleRushTimers();
      setBubbles([]);

      if (success) {
        energyRef.current = clamp(energyRef.current + 18, 0, 100);
        const totalCoins = 15 + state.totalCoins;
        awardCoins(totalCoins, `Bubble Rush clear! Nice!`);
      } else if (!silent) {
        if (state.totalCoins > 0) {
          awardCoins(state.totalCoins, 'Bubble Rush');
        }
        showToast('Bubble Rush over! Try again.');
      }
      syncPlayHud();
    },
    [awardCoins, clearBubbleRushTimers, showToast, syncPlayHud],
  );

  const spawnBubble = useCallback(() => {
    const state = bubbleRushRef.current;
    if (!state.active) return;

    // Bubble type selection
    const roll = Math.random();
    let type: 'normal' | 'golden' | 'tiny' = 'normal';
    let size = 24 + Math.random() * 46;
    let durationMs = 2600 + Math.random() * 1800;

    if (roll < 0.08) {
      type = 'golden';
      size = 34 + Math.random() * 30;
      durationMs = 3000 + Math.random() * 1500;
    } else if (roll < 0.25) {
      type = 'tiny';
      size = 18 + Math.random() * 16;
      durationMs = 1800 + Math.random() * 1200;
    }

    const bubble: Bubble = {
      id: makeBubbleId(),
      left: 5 + Math.random() * 90,
      size,
      durationMs,
      type,
    };
    setBubbles((current) => [...current, bubble]);
  }, []);

  const startBubbleRush = useCallback(() => {
    const state = bubbleRushRef.current;
    if (state.active) return;
    state.active = true;
    state.popped = 0;
    state.target = 12;
    state.endsAt = Date.now() + 20000;
    state.totalCoins = 0;
    setBubbles([]);
    syncPlayHud('Bubble Rush started! Pop 12 bubbles.');
    for (let i = 0; i < 4; i += 1) spawnBubble();
    state.spawnTimer = window.setInterval(() => {
      spawnBubble();
      if (Math.random() < 0.35) spawnBubble();
    }, 560);
    state.countdownTimer = window.setInterval(() => {
      if (Date.now() >= state.endsAt) {
        endBubbleRush(state.popped >= state.target);
      } else {
        syncPlayHud();
      }
    }, 200);
  }, [endBubbleRush, spawnBubble, syncPlayHud]);

  const resetPlaySession = useCallback(() => {
    clearBubbleRushTimers();
    bubbleRushRef.current = { ...initialBubbleRush };
    setBubbles([]);
    energyRef.current = 0;
    comboRef.current = 0;
    lastActionAtRef.current = 0;
    setShowUltimateText(false);
    syncPlayHud('Charge up your slime for Mega Morph!');
    startEnergyDecay();
  }, [clearBubbleRushTimers, startEnergyDecay, syncPlayHud]);

  const leavePlayMode = useCallback(() => {
    stopEnergyDecay();
    endBubbleRush(false, true);
  }, [endBubbleRush, stopEnergyDecay]);

  const openPlay = useCallback(
    (slime: Slime) => {
      setPlaySlime(slime);
      setScreen('play');
      resetPlaySession();
    },
    [resetPlaySession],
  );

  const goScreen = useCallback(
    (next: Screen) => {
      setScreen((current) => {
        if (current === 'play' && next !== 'play') leavePlayMode();
        return next;
      });
    },
    [leavePlayMode],
  );

  /* ---- Pixi interaction ---- */

  const handlePixiInteract = useCallback(
    (kind: Exclude<InteractionKind, 'bubble'>) => {
      const gains: Record<Exclude<InteractionKind, 'bubble'>, number> = {
        drag: 5, poke: 10, squish: 12, stretch: 11, bounce: 13, mega: 0,
      };
      registerPlayAction(kind, gains[kind]);
    },
    [registerPlayAction],
  );

  const handleBubblePop = useCallback(
    (bubble: Bubble) => {
      setBubbles((current) => current.filter((b) => b.id !== bubble.id));
      const state = bubbleRushRef.current;
      if (!state.active) return;

      const coinValue = bubble.type === 'golden' ? 5 : bubble.type === 'tiny' ? 2 : 1;
      state.totalCoins += coinValue;

      pixiRef.current?.burst(bubble.type === 'golden' ? 8 : 4);
      registerPlayAction('bubble', bubble.type === 'golden' ? 14 : bubble.type === 'tiny' ? 6 : 9);
      state.popped += 1;
      if (state.popped >= state.target) {
        endBubbleRush(true);
      } else {
        syncPlayHud();
      }
    },
    [endBubbleRush, registerPlayAction, syncPlayHud],
  );

  const handleBubbleExpired = useCallback((bubbleId: string) => {
    setBubbles((current) => current.filter((bubble) => bubble.id !== bubbleId));
  }, []);

  const handleToggleBubbleRush = useCallback(() => {
    if (bubbleRushRef.current.active) {
      endBubbleRush(false, true);
      showToast('Bubble Rush stopped.');
      return;
    }
    startBubbleRush();
  }, [endBubbleRush, showToast, startBubbleRush]);

  const handleMegaMorph = useCallback(() => {
    if (!canMegaMorph) {
      showToast('Charge to 100% first!');
      return;
    }
    pixiRef.current?.megaMorph();
    pixiRef.current?.burst(12);
    awardCoins(15, 'Mega Morph');
    comboRef.current = 0;
    energyRef.current = 24;
    lastActionAtRef.current = Date.now();
    setShowUltimateText(true);
    syncPlayHud('MEGA MORPH unleashed!!');
    setTimeout(() => setShowUltimateText(false), 2000);
  }, [awardCoins, canMegaMorph, showToast, syncPlayHud]);

  /* ---- CRUD ---- */

  const handleCreateSlime = useCallback(async () => {
    if (!profile) return;
    const name = createOptions.name.trim() || 'Squishy';
    const payload = {
      user_id: profile.id,
      name,
      color: createOptions.color,
      sparkle: createOptions.sparkle,
      charm: createOptions.charm,
    };
    const { data, error } = await supabase.from('slimes').insert(payload).select('*').single();
    if (error || !data) {
      showToast('Could not save slime. Try again.');
      return;
    }
    const created = data as Slime;
    setSlimes((current) => [created, ...current]);
    updateProfile((current) => ({ ...current, coins: current.coins + 10 }));
    showToast('New slime made! +10 coins');
    openPlay(created);
  }, [createOptions, openPlay, profile, showToast, updateProfile]);

  const handleDeleteCurrentSlime = useCallback(async () => {
    if (!playSlime || !profile) return;
    if (playSlime.user_id !== profile.id) return;
    const confirmed = window.confirm(`Delete ${playSlime.name}?`);
    if (!confirmed) return;
    const { error } = await supabase.from('slimes').delete().eq('id', playSlime.id);
    if (error) { showToast('Could not delete slime.'); return; }
    setSlimes((current) => current.filter((slime) => slime.id !== playSlime.id));
    setPlaySlime(null);
    goScreen('home');
    showToast('Slime deleted.');
  }, [goScreen, playSlime, profile, showToast]);

  const handleBuyItem = useCallback(
    (id: string, type: ShopType, price: number) => {
      if (!profile) return;
      const owned =
        type === 'color' ? profile.owned_colors.includes(id)
        : type === 'sparkle' ? profile.owned_sparkles.includes(id)
        : profile.owned_charms.includes(id);
      if (owned) { showToast('You already own that!'); return; }
      if (profile.coins < price) { showToast('Need more coins!'); return; }
      updateProfile((current) => {
        const next: Profile = { ...current, coins: current.coins - price };
        if (type === 'color') next.owned_colors = [...new Set([...current.owned_colors, id])];
        if (type === 'sparkle') next.owned_sparkles = [...new Set([...current.owned_sparkles, id])];
        if (type === 'charm') next.owned_charms = [...new Set([...current.owned_charms, id])];
        return next;
      });
      const item = [...ALL_COLORS, ...ALL_SPARKLES, ...ALL_CHARMS].find((entry) => entry.id === id);
      showToast(`Bought ${item?.name ?? 'item'}!`);
    },
    [profile, showToast, updateProfile],
  );

  /* ---- Sharing ---- */

  const handleCreateShare = useCallback(async (slimeId: string) => {
    setShareModal({ visible: true, slimeId, shareCode: null, loading: true });
    try {
      const code = generateShareCode();
      const { error } = await supabase.rpc('create_slime_share', {
        p_slime_id: slimeId,
        p_share_code: code,
      });
      if (error) {
        // Fallback: try direct insert if RPC not available
        const { error: insertError } = await supabase.from('slime_shares').insert({
          slime_id: slimeId,
          share_code: code,
          created_by_profile_id: profile?.id,
        });
        if (insertError) {
          showToast('Could not create share code. The sharing tables may not be set up yet.');
          setShareModal((prev) => ({ ...prev, loading: false, visible: false }));
          return;
        }
      }
      setShareModal({ visible: true, slimeId, shareCode: code, loading: false });
    } catch {
      showToast('Could not create share code.');
      setShareModal((prev) => ({ ...prev, loading: false, visible: false }));
    }
  }, [profile?.id, showToast]);

  const handleRedeemCode = useCallback(async () => {
    const code = normalizeShareCode(redeemState.code);
    if (code.length < 6) {
      setRedeemState((prev) => ({ ...prev, error: 'Code must be at least 6 characters.' }));
      return;
    }
    setRedeemState((prev) => ({ ...prev, loading: true, error: null, result: null }));
    try {
      const { data, error } = await supabase.rpc('get_shared_slime', { p_share_code: code });
      if (error) {
        // Fallback: direct query
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('slime_shares')
          .select('share_code, slimes(id, name, color, sparkle, charm), profiles!slime_shares_created_by_profile_id_fkey(username)')
          .eq('share_code', code)
          .eq('is_revoked', false)
          .maybeSingle();

        if (fallbackError || !fallbackData) {
          setRedeemState((prev) => ({ ...prev, loading: false, error: 'Share code not found or expired.' }));
          return;
        }

        const s = fallbackData.slimes as unknown as { id: string; name: string; color: string; sparkle: string; charm: string };
        const p = fallbackData.profiles as unknown as { username: string };
        setRedeemState((prev) => ({
          ...prev,
          loading: false,
          result: {
            id: s.id,
            name: s.name,
            color: s.color,
            sparkle: s.sparkle,
            charm: s.charm,
            share_code: code,
            creator_name: p?.username ?? 'friend',
          },
        }));
        return;
      }

      setRedeemState((prev) => ({
        ...prev,
        loading: false,
        result: data as SharedSlimeData,
      }));
    } catch {
      setRedeemState((prev) => ({ ...prev, loading: false, error: 'Could not look up that code.' }));
    }
  }, [redeemState.code]);

  const handlePlaySharedSlime = useCallback((shared: SharedSlimeData) => {
    const fakeSlime: Slime = {
      id: shared.id,
      user_id: '__shared__',
      name: shared.name,
      color: shared.color,
      sparkle: shared.sparkle,
      charm: shared.charm,
      profiles: { username: shared.creator_name },
    };
    openPlay(fakeSlime);
  }, [openPlay]);

  const handleCopyShareCode = useCallback((code: string) => {
    const formatted = formatShareCode(code);
    navigator.clipboard.writeText(formatted).then(
      () => showToast('Code copied!'),
      () => showToast(formatted),
    );
  }, [showToast]);

  /* ---- Auth ---- */

  const signInOrCreate = useCallback(async () => {
    const username = normalizeUsername(authUsername);
    const code = authCode.trim();
    setAuthError('');
    if (!username || username.length < 2) { setAuthError('Name must be at least 2 characters.'); return; }
    if (!/^\d{4}$/.test(code)) { setAuthError('Kid code must be exactly 4 digits.'); return; }

    setAuthBusy(true);
    try {
      const email = `${username}@slimemaker.game`;
      const password = buildKidPassword(code);
      let created = false;
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (!isInvalidLoginError(signInError)) {
          setAuthError(getErrorMessage(signInError, 'Could not log in.'));
          return;
        }
        const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
        if (signUpError) {
          if (isAlreadyExistsError(signUpError)) {
            setAuthError('That name exists with a different code.');
          } else {
            setAuthError(getErrorMessage(signUpError, 'Could not create account.'));
          }
          return;
        }
        created = true;
        const { error: secondSignInError } = await supabase.auth.signInWithPassword({ email, password });
        if (secondSignInError) {
          setAuthError(getErrorMessage(secondSignInError, 'Account created, but login failed.'));
          return;
        }
      }
      const ensuredProfile = await ensureProfileExists(username);
      setProfile(ensuredProfile);
      setSlimes(await loadMySlimes(ensuredProfile.id));
      setScreen('home');
      setAuthCode('');
      setAuthUsername('');
      showToast(created ? `Hi ${ensuredProfile.username}! Account ready.` : `Welcome back, ${ensuredProfile.username}!`);
    } catch (error) {
      console.error(error);
      setAuthError(getErrorMessage(error, 'Something went wrong. Try again.'));
    } finally {
      setAuthBusy(false);
    }
  }, [authCode, authUsername, ensureProfileExists, loadMySlimes, showToast]);

  const handleLogout = useCallback(async () => {
    if (!window.confirm('Switch player?')) return;
    leavePlayMode();
    await supabase.auth.signOut();
    setProfile(null);
    setSlimes([]);
    setFriendsSlimes([]);
    setPlaySlime(null);
    setScreen('auth');
    setAuthCode('');
    setAuthUsername('');
    setAuthError('');
  }, [leavePlayMode]);

  /* ---- Effects ---- */

  useEffect(() => {
    isOwnPlaySlimeRef.current = Boolean(profile && playSlime && playSlime.user_id === profile.id);
  }, [playSlime, profile]);

  useEffect(() => { screenRef.current = screen; }, [screen]);

  useEffect(() => {
    if (!profile) return;
    if (screen === 'collection') {
      setLoadingCollection(true);
      loadMySlimes(profile.id).then((items) => setSlimes(items)).finally(() => setLoadingCollection(false));
    }
    if (screen === 'friends') {
      setLoadingFriends(true);
      loadFriends(profile.id).then((items) => setFriendsSlimes(items)).finally(() => setLoadingFriends(false));
    }
    if (screen === 'create') {
      setCreateOptions((current) => ({ ...current, color: profile.owned_colors[0] ?? STARTER_COLORS[0] }));
    }
  }, [loadFriends, loadMySlimes, profile, screen]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || !isMounted) return;
      const usernameGuess = normalizeUsername(
        String(data.session.user.user_metadata?.username ?? data.session.user.email?.split('@')[0] ?? ''),
      );
      if (!usernameGuess) return;
      const ensuredProfile = await ensureProfileExists(usernameGuess);
      if (!isMounted) return;
      setProfile(ensuredProfile);
      setSlimes(await loadMySlimes(ensuredProfile.id));
      setScreen('home');
    })().catch((error) => console.error('Initial session load failed:', error));
    return () => { isMounted = false; };
  }, [ensureProfileExists, loadMySlimes]);

  useEffect(() => {
    if (IS_IOS) document.body.classList.add('platform-ios');
    const updateVh = () => {
      const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${viewportHeight * 0.01}px`);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) document.body.classList.add('ios-keyboard-open');
    };
    const onFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || !active.matches('input, textarea, select')) document.body.classList.remove('ios-keyboard-open');
      }, 80);
    };
    updateVh();
    window.addEventListener('resize', updateVh);
    window.visualViewport?.addEventListener('resize', updateVh);
    window.visualViewport?.addEventListener('scroll', updateVh);
    if (IS_IOS) {
      document.addEventListener('focusin', onFocusIn);
      document.addEventListener('focusout', onFocusOut);
    }
    return () => {
      window.removeEventListener('resize', updateVh);
      window.visualViewport?.removeEventListener('resize', updateVh);
      window.visualViewport?.removeEventListener('scroll', updateVh);
      if (IS_IOS) {
        document.removeEventListener('focusin', onFocusIn);
        document.removeEventListener('focusout', onFocusOut);
        document.body.classList.remove('platform-ios');
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      leavePlayMode();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [leavePlayMode]);

  /* ===============================
     RENDER
     =============================== */

  return (
    <div className="app-shell">
      <div className="fx-background" aria-hidden="true">
        <div className="fx-orb orb-a" />
        <div className="fx-orb orb-b" />
        <div className="fx-orb orb-c" />
        <div className="fx-grid" />
      </div>

      {profile && (
        <>
          <button className="coin-display" type="button" onClick={() => goScreen('shop')}>
            🪙 {coinBalance}
          </button>
          <button className="user-display" type="button" onClick={handleLogout}>
            {profile.username}
          </button>
        </>
      )}

      {/* ===== AUTH ===== */}
      {screen === 'auth' && (
        <main className="screen auth-screen">
          <h1 className="title">Slime Maker v3</h1>
          <div className="auth-card">
            <h2>Who is playing?</h2>
            <p>Use the same name + 4-digit code on any device.</p>
            <input
              className="auth-input"
              value={authUsername}
              onChange={(event) => setAuthUsername(event.target.value)}
              placeholder="Name"
              maxLength={20}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              onKeyDown={(event) => { if (event.key === 'Enter') document.getElementById('authCode')?.focus(); }}
            />
            <input
              id="authCode"
              className="auth-input"
              value={authCode}
              onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-digit kid code"
              maxLength={4}
              inputMode="numeric"
              enterKeyHint="go"
              onKeyDown={(event) => { if (event.key === 'Enter') void signInOrCreate(); }}
            />
            <div className="auth-error">{authError}</div>
            <GameButton variant="primary" size="lg" loading={authBusy} onClick={() => void signInOrCreate()}>
              Let's Play!
            </GameButton>
          </div>
        </main>
      )}

      {/* ===== MAIN SCREENS ===== */}
      {screen !== 'auth' && profile && (
        <main className="screen">

          {/* --- HOME --- */}
          {screen === 'home' && (
            <GlassCard className="center">
              <h1 className="title">Slime Maker</h1>
              <MiniSlime color="#55efc4" sparkle="stars" charm="star" />
              <div className="stack">
                <GameButton variant="primary" size="lg" onClick={() => goScreen('create')}>
                  Create a Slime
                </GameButton>
                <GameButton variant="secondary" size="lg" onClick={() => goScreen('collection')}>
                  My Slimes
                </GameButton>
                <GameButton variant="blue" size="lg" onClick={() => goScreen('friends')}>
                  Friends' Slimes
                </GameButton>
                <GameButton variant="orange" size="lg" onClick={() => goScreen('shop')}>
                  Shop
                </GameButton>
              </div>
            </GlassCard>
          )}

          {/* --- CREATE --- */}
          {screen === 'create' && (
            <GlassCard header="Create your slime" subtitle="Pick a look for your new friend!">
              <GameButton variant="ghost" size="sm" onClick={() => goScreen('home')}>Back</GameButton>
              <div className="preview-wrap">
                <MiniSlime
                  color={createOptions.color}
                  sparkle={createOptions.sparkle}
                  charm={createOptions.charm}
                />
              </div>

              <h3 className="section-label">Pick a color</h3>
              <div className="chips">
                {ALL_COLORS.map((colorItem) => {
                  const owned = ownedColorSet.has(colorItem.id);
                  const selected = createOptions.color === colorItem.id;
                  return (
                    <button
                      key={colorItem.id}
                      className={`color-chip ${selected ? 'selected' : ''} ${owned ? '' : 'locked'}`}
                      type="button"
                      style={{ background: colorItem.id }}
                      title={owned ? colorItem.name : `${colorItem.name} (${colorItem.price} coins)`}
                      onClick={() => {
                        if (!owned) { showToast(`Buy ${colorItem.name} first!`); return; }
                        setCreateOptions((current) => ({ ...current, color: colorItem.id }));
                      }}
                    />
                  );
                })}
              </div>

              <h3 className="section-label">Sparkles</h3>
              <div className="chips">
                {ALL_SPARKLES.map((sparkle) => {
                  const owned = ownedSparkleSet.has(sparkle.id);
                  const selected = createOptions.sparkle === sparkle.id;
                  return (
                    <button
                      key={sparkle.id}
                      className={`chip-btn ${selected ? 'selected' : ''} ${owned ? '' : 'locked'}`}
                      type="button"
                      onClick={() => {
                        if (!owned) { showToast(`Buy ${sparkle.name} first!`); return; }
                        setCreateOptions((current) => ({ ...current, sparkle: sparkle.id }));
                      }}
                    >
                      {sparkle.emoji ? `${sparkle.emoji} ${sparkle.name}` : sparkle.name}
                    </button>
                  );
                })}
              </div>

              <h3 className="section-label">Charm</h3>
              <div className="chips">
                {ALL_CHARMS.map((charm) => {
                  const owned = ownedCharmSet.has(charm.id);
                  const selected = createOptions.charm === charm.id;
                  return (
                    <button
                      key={charm.id}
                      className={`chip-btn ${selected ? 'selected' : ''} ${owned ? '' : 'locked'}`}
                      type="button"
                      onClick={() => {
                        if (!owned) { showToast(`Buy ${charm.name} first!`); return; }
                        setCreateOptions((current) => ({ ...current, charm: charm.id }));
                      }}
                    >
                      {charm.emoji ? `${charm.emoji} ${charm.name}` : charm.name}
                    </button>
                  );
                })}
              </div>

              <input
                className="name-input"
                value={createOptions.name}
                placeholder="Slime name"
                maxLength={20}
                onChange={(event) => setCreateOptions((current) => ({ ...current, name: event.target.value }))}
              />
              <GameButton variant="green" size="lg" onClick={() => void handleCreateSlime()}>
                Make My Slime (+10 coins)
              </GameButton>
            </GlassCard>
          )}

          {/* --- COLLECTION --- */}
          {screen === 'collection' && (
            <GlassCard header="My Slimes" subtitle="Tap a slime to play!">
              <GameButton variant="ghost" size="sm" onClick={() => goScreen('home')}>Back</GameButton>
              {loadingCollection && <div className="subtle">Loading...</div>}
              {!loadingCollection && slimes.length === 0 && <div className="subtle">No slimes yet. Create one!</div>}
              <div className="grid">
                {slimes.map((slime) => {
                  const sparkleData = findSparkle(slime.sparkle);
                  const charmData = findCharm(slime.charm);
                  return (
                    <div key={slime.id} className="card" onClick={() => openPlay(slime)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openPlay(slime); }}>
                      <MiniSlime color={slime.color} sparkle={slime.sparkle} charm={slime.charm} size="small" />
                      <div className="card-title">{slime.name}</div>
                      <div className="card-badges">
                        {sparkleData && sparkleData.id !== 'none' && <span>{sparkleData.emoji}</span>}
                        {charmData && charmData.id !== 'none' && <span>{charmData.emoji}</span>}
                      </div>
                      <div className="card-cta">Tap to play</div>
                      <GameButton
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); void handleCreateShare(slime.id); }}
                      >
                        Share
                      </GameButton>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}

          {/* --- FRIENDS --- */}
          {screen === 'friends' && (
            <GlassCard header="Friends' Slimes" subtitle="Explore slimes from other players!">
              <GameButton variant="ghost" size="sm" onClick={() => goScreen('home')}>Back</GameButton>

              {/* Redeem share code */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="share-input"
                  value={redeemState.code}
                  onChange={(e) => setRedeemState((prev) => ({ ...prev, code: e.target.value, error: null }))}
                  placeholder="Paste share code"
                  maxLength={10}
                  style={{ flex: 1, minWidth: 140 }}
                />
                <GameButton
                  variant="primary"
                  size="sm"
                  loading={redeemState.loading}
                  onClick={() => void handleRedeemCode()}
                >
                  Redeem
                </GameButton>
              </div>
              {redeemState.error && <div className="auth-error">{redeemState.error}</div>}

              {/* Redeemed slime preview */}
              {redeemState.result && (
                <div className="card" style={{ maxWidth: 280, margin: '0 auto' }}>
                  <MiniSlime
                    color={redeemState.result.color}
                    sparkle={redeemState.result.sparkle}
                    charm={redeemState.result.charm}
                    size="small"
                  />
                  <div className="card-title">{redeemState.result.name}</div>
                  <div className="card-subtitle">by {redeemState.result.creator_name}</div>
                  <GameButton variant="primary" size="sm" onClick={() => handlePlaySharedSlime(redeemState.result!)}>
                    Play with this slime!
                  </GameButton>
                </div>
              )}

              {loadingFriends && <div className="subtle">Loading...</div>}
              {!loadingFriends && friendsSlimes.length === 0 && !redeemState.result && (
                <div className="subtle">No friends yet. Share a code to connect!</div>
              )}
              <div className="grid">
                {friendsSlimes.map((slime) => (
                  <div key={slime.id} className="card" onClick={() => openPlay(slime)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openPlay(slime); }}>
                    <MiniSlime color={slime.color} sparkle={slime.sparkle} charm={slime.charm} size="small" />
                    <div className="card-title">{slime.name}</div>
                    <div className="card-subtitle">by {slime.profiles?.username ?? 'friend'}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* --- SHOP --- */}
          {screen === 'shop' && (
            <GlassCard header="Shop" subtitle={`You have 🪙 ${coinBalance} coins`}>
              <GameButton variant="ghost" size="sm" onClick={() => goScreen('home')}>Back</GameButton>

              <ShopSection
                title="Colors"
                items={ALL_COLORS.filter((item) => item.price > 0)}
                isOwned={(id) => ownedColorSet.has(id)}
                canAfford={(price) => coinBalance >= price}
                onBuy={(id, price) => handleBuyItem(id, 'color', price)}
                renderPreview={(item) => <div className="shop-color-preview" style={{ background: item.id }} />}
              />
              <ShopSection
                title="Sparkles"
                items={ALL_SPARKLES.filter((item) => item.price > 0)}
                isOwned={(id) => ownedSparkleSet.has(id)}
                canAfford={(price) => coinBalance >= price}
                onBuy={(id, price) => handleBuyItem(id, 'sparkle', price)}
                renderPreview={(item) => <div className="shop-emoji">{(item as SparkleItem).emoji}</div>}
              />
              <ShopSection
                title="Charms"
                items={ALL_CHARMS.filter((item) => item.price > 0)}
                isOwned={(id) => ownedCharmSet.has(id)}
                canAfford={(price) => coinBalance >= price}
                onBuy={(id, price) => handleBuyItem(id, 'charm', price)}
                renderPreview={(item) => <div className="shop-emoji">{(item as CharmItem).emoji}</div>}
              />
            </GlassCard>
          )}

          {/* --- PLAY --- */}
          {screen === 'play' && playSlime && (
            <GlassCard>
              <GameButton variant="ghost" size="sm" onClick={() => goScreen('home')}>Home</GameButton>
              <p className="play-title">
                {playSlime.user_id === profile.id
                  ? `Playing with ${playSlime.name}!`
                  : `${playSlime.profiles?.username ?? 'Friend'}'s ${playSlime.name}`}
              </p>

              <TopHUD
                mood={playHud.mood}
                energy={playHud.energy}
                combo={playHud.combo}
                status={playHud.status}
              />

              <div className="play-stage-wrap">
                <PixiSlimeStage ref={pixiRef} slime={playSlime} onInteract={handlePixiInteract} />
                {showUltimateText && (
                  <div className="ultimate-overlay">
                    <div className="ultimate-text">MEGA SLIME!!</div>
                  </div>
                )}
                <div className="bubble-layer">
                  {bubbles.map((bubble) => (
                    <button
                      key={bubble.id}
                      type="button"
                      className={`bubble ${bubble.type === 'golden' ? 'golden' : ''}`}
                      style={{
                        left: `${bubble.left}%`,
                        width: `${bubble.size}px`,
                        height: `${bubble.size}px`,
                        animationDuration: `${bubble.durationMs}ms`,
                      }}
                      onClick={() => handleBubblePop(bubble)}
                      onAnimationEnd={() => handleBubbleExpired(bubble.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="play-buttons">
                <GameButton variant="secondary" size="sm" onClick={() => pixiRef.current?.poke()}>
                  Poke
                </GameButton>
                <GameButton variant="primary" size="sm" onClick={() => pixiRef.current?.squish()}>
                  Squish
                </GameButton>
                <GameButton variant="green" size="sm" onClick={() => pixiRef.current?.stretch()}>
                  Stretch
                </GameButton>
                <GameButton variant="blue" size="sm" onClick={() => pixiRef.current?.bounce()}>
                  Bounce
                </GameButton>
              </div>

              <div className="play-buttons">
                <GameButton
                  variant="gold"
                  size="md"
                  disabled={!canMegaMorph}
                  onClick={handleMegaMorph}
                >
                  {canMegaMorph ? '⚡ Mega Morph ⚡' : 'Mega Morph'}
                </GameButton>
                <GameButton variant="secondary" size="md" onClick={handleToggleBubbleRush}>
                  {bubbleRushActive ? 'Stop Rush' : 'Bubble Rush'}
                </GameButton>
              </div>

              {playSlime.user_id === profile.id && (
                <div className="play-buttons">
                  <GameButton variant="danger" size="sm" onClick={() => void handleDeleteCurrentSlime()}>
                    Delete Slime
                  </GameButton>
                </div>
              )}
            </GlassCard>
          )}
        </main>
      )}

      {/* ===== SHARE MODAL ===== */}
      {shareModal.visible && (
        <div className="modal-overlay" onClick={() => setShareModal((prev) => ({ ...prev, visible: false }))}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Share your slime!</h2>
            <p style={{ color: 'var(--text-soft)' }}>
              Give this code to a friend. They can use it on the Friends' Slimes screen.
            </p>
            {shareModal.loading && <div className="subtle">Creating share code...</div>}
            {shareModal.shareCode && (
              <>
                <div className="share-code-display">{formatShareCode(shareModal.shareCode)}</div>
                <GameButton variant="primary" size="md" onClick={() => handleCopyShareCode(shareModal.shareCode!)}>
                  Copy Code
                </GameButton>
              </>
            )}
            <GameButton variant="ghost" size="sm" onClick={() => setShareModal((prev) => ({ ...prev, visible: false }))}>
              Close
            </GameButton>
          </div>
        </div>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <button
          className="toast"
          type="button"
          onClick={() => {
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            setToast(null);
          }}
        >
          {toast}
        </button>
      )}
    </div>
  );
}

/* ===============================
   SHOP SECTION
   =============================== */

function ShopSection({
  title,
  items,
  isOwned,
  canAfford,
  onBuy,
  renderPreview,
}: {
  title: string;
  items: Array<{ id: string; name: string; price: number }>;
  isOwned: (id: string) => boolean;
  canAfford: (price: number) => boolean;
  onBuy: (id: string, price: number) => void;
  renderPreview: (item: { id: string; name: string; price: number }) => ReactNode;
}) {
  return (
    <section className="shop-section">
      <h3>{title}</h3>
      <div className="shop-grid">
        {items.map((item) => {
          const owned = isOwned(item.id);
          const afford = canAfford(item.price);
          return (
            <div key={item.id} className={`shop-item ${owned ? 'owned' : ''}`}>
              {renderPreview(item)}
              <div className="shop-name">{item.name}</div>
              {owned ? (
                <div className="owned-label">Owned</div>
              ) : (
                <>
                  <div className="price">🪙 {item.price}</div>
                  <GameButton
                    variant={afford ? 'orange' : 'ghost'}
                    size="sm"
                    disabled={!afford}
                    onClick={() => onBuy(item.id, item.price)}
                  >
                    {afford ? 'Buy' : 'Need coins'}
                  </GameButton>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
