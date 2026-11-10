import { DIFFICULTY_TABLE, Difficulty } from './Constants';
import { GraphicsQuality } from '../rendering/GraphicsPresets';

export type AppScreen =
  | 'loading'
  | 'title'
  | 'briefing'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'map'
  | 'success'
  | 'failure';

export interface Settings {
  mouseSensitivity: number; // 0..1
  difficulty: Difficulty;
  muted: boolean;
  reducedScreenShake: boolean;
  showFps: boolean;
  /** Graphics preset; 'auto' lets AdaptiveQuality pick and tune. */
  graphicsQuality: GraphicsQuality;
  /** Chase-camera spring damping scale (1 = default firmness). */
  cameraDamping: number;
  /** Whether FOV widens with speed / afterburner. */
  speedFov: boolean;
  /** Master switch that disables camera shake and other non-essential motion. */
  reducedMotion: boolean;
  /** Developer performance overlay. */
  showPerfOverlay: boolean;
}

export interface SessionBest {
  score: number;
  grade: string;
}

const GRAPHICS_QUALITIES: GraphicsQuality[] = ['auto', 'low', 'medium', 'high'];
const SETTINGS_KEY = 'obb.settings.v1';
const BEST_KEY = 'obb.best.v1';

function readStored<T>(key: string): Partial<T> | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Storage blocked or corrupt; fall back to defaults.
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota); persistence is best-effort.
  }
}

/** Small shared bucket of state that many systems read/write across screens. */
export class GameState {
  screen: AppScreen = 'loading';
  settings: Settings = {
    mouseSensitivity: 0.5,
    difficulty: 'normal',
    muted: false,
    reducedScreenShake: false,
    showFps: false,
    graphicsQuality: 'auto',
    cameraDamping: 1,
    speedFov: true,
    reducedMotion: false,
    showPerfOverlay: false,
  };
  skipCarrierLaunch = false;
  sessionBest: SessionBest | null = null;
  paused = false;

  constructor() {
    // Only accept stored values whose type matches the default, so a stale or hand-edited entry
    // cannot put the settings into an invalid shape.
    const stored = readStored<Settings>(SETTINGS_KEY);
    if (stored) {
      const target = this.settings as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(stored)) {
        if (key in target && typeof value === typeof target[key]) target[key] = value;
      }
      if (!(this.settings.difficulty in DIFFICULTY_TABLE)) this.settings.difficulty = 'normal';
      if (!GRAPHICS_QUALITIES.includes(this.settings.graphicsQuality)) this.settings.graphicsQuality = 'auto';
    }
    const best = readStored<SessionBest>(BEST_KEY);
    if (best && typeof best.score === 'number' && typeof best.grade === 'string') {
      this.sessionBest = { score: best.score, grade: best.grade };
    }
  }

  saveSettings() {
    writeStored(SETTINGS_KEY, this.settings);
  }

  saveBest() {
    if (this.sessionBest) writeStored(BEST_KEY, this.sessionBest);
  }
}
