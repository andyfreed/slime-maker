import type { PlayMood } from '../../types';

const moodConfig: Record<PlayMood, { icon: string; color: string }> = {
  Chill: { icon: '😌', color: '#74b9ff' },
  Happy: { icon: '😊', color: '#55efc4' },
  Playful: { icon: '😜', color: '#a29bfe' },
  Hyper: { icon: '🤩', color: '#f093fb' },
  Legendary: { icon: '🔥', color: '#ffeaa7' },
};

interface TopHUDProps {
  mood: PlayMood;
  energy: number;
  combo: number;
  status: string;
}

export function TopHUD({ mood, energy, combo, status }: TopHUDProps) {
  const mc = moodConfig[mood];
  const isFull = energy >= 100;
  const isNearFull = energy >= 85;

  return (
    <div className="top-hud">
      <div className="top-hud-row">
        <div className="hud-mood" style={{ borderColor: mc.color }}>
          <span className="hud-mood-icon">{mc.icon}</span>
          <span className="hud-mood-label" style={{ color: mc.color }}>{mood}</span>
        </div>
        <div className="hud-energy-wrap">
          <div className="hud-energy-track">
            <div
              className={`hud-energy-fill ${isFull ? 'full' : ''} ${isNearFull && !isFull ? 'near-full' : ''}`}
              style={{ width: `${energy}%` }}
            />
            <span className="hud-energy-text">{energy}%</span>
          </div>
        </div>
        {combo > 1 && (
          <div className={`hud-combo ${combo >= 5 ? 'hud-combo-hot' : ''}`}>
            x{combo}
          </div>
        )}
      </div>
      <div className="hud-status">{status}</div>
    </div>
  );
}
