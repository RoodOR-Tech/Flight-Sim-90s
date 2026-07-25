// Unit conversions and shared tunable constants for the whole simulation.
export const MPS_TO_KNOTS = 1.94384;
export const METERS_TO_FEET = 3.28084;
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export const GRAVITY = 9.81;

export const WORLD_BOUNDARY_RADIUS = 9000; // soft boundary, meters from origin
export const WORLD_BOUNDARY_WARN = 7800;
export const WORLD_BOUNDARY_KILL_TIME = 25; // seconds allowed outside hard boundary

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultySettings {
  enemyAccuracy: number; // 0..1 chance factor per burst
  enemyReactionTime: number; // seconds
  enemyHealth: number;
  enemyAggression: number; // maneuver performance multiplier
  playerDamageMultiplier: number;
}

export const DIFFICULTY_TABLE: Record<Difficulty, DifficultySettings> = {
  easy: {
    enemyAccuracy: 0.28,
    enemyReactionTime: 1.6,
    enemyHealth: 80,
    enemyAggression: 0.75,
    playerDamageMultiplier: 0.7,
  },
  normal: {
    enemyAccuracy: 0.45,
    enemyReactionTime: 0.9,
    enemyHealth: 110,
    enemyAggression: 1.0,
    playerDamageMultiplier: 1.0,
  },
  hard: {
    enemyAccuracy: 0.62,
    enemyReactionTime: 0.45,
    enemyHealth: 140,
    enemyAggression: 1.3,
    playerDamageMultiplier: 1.35,
  },
};

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_DT = 0.1;
