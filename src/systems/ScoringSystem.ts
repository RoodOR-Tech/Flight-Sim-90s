export interface ScoreInput {
  enemiesDestroyed: number; // 0..2
  radarDestroyed: boolean;
  cannonAccuracy: number; // 0..1
  missilesRemaining: number; // 0..4
  playerHealthFraction: number; // 0..1
  completionTimeSeconds: number;
  landedSuccessfully: boolean;
  civilianStrikes: number;
}

export interface ScoreResult {
  score: number;
  grade: string;
  breakdown: {
    enemies: number;
    radar: number;
    accuracy: number;
    missiles: number;
    health: number;
    landing: number;
    timeBonus: number;
    civilianPenalty: number;
  };
}

const TIME_PAR_SECONDS = 600;

/** Pure scoring function so it can be unit tested without any game/engine state. */
export function calculateScore(input: ScoreInput): ScoreResult {
  const enemies = Math.max(0, Math.min(2, input.enemiesDestroyed)) * 1000;
  const radar = input.radarDestroyed ? 800 : 0;
  const accuracy = Math.max(0, Math.min(1, input.cannonAccuracy)) * 500;
  const missiles = Math.max(0, Math.min(4, input.missilesRemaining)) * 100;
  const health = Math.max(0, Math.min(1, input.playerHealthFraction)) * 400;
  const landing = input.landedSuccessfully ? 500 : 0;
  const timeBonus = Math.max(0, TIME_PAR_SECONDS - Math.max(0, input.completionTimeSeconds));
  const civilianPenalty = Math.max(0, input.civilianStrikes) * 300;

  const rawScore = enemies + radar + accuracy + missiles + health + landing + timeBonus - civilianPenalty;
  const score = Math.max(0, Math.round(rawScore));

  let grade: string;
  if (!input.landedSuccessfully) {
    grade = score >= 2000 ? 'C' : 'D';
  } else if (score >= 4500) grade = 'S';
  else if (score >= 3600) grade = 'A';
  else if (score >= 2600) grade = 'B';
  else if (score >= 1600) grade = 'C';
  else if (score >= 800) grade = 'D';
  else grade = 'F';

  return {
    score,
    grade,
    breakdown: { enemies, radar, accuracy, missiles, health, landing, timeBonus, civilianPenalty },
  };
}
