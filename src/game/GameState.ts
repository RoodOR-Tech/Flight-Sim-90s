import { Difficulty } from './Constants';
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
}
