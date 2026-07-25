import { Difficulty } from './Constants';

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
  };
  skipCarrierLaunch = false;
  sessionBest: SessionBest | null = null;
  paused = false;
}
