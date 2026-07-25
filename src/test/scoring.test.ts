import { describe, it, expect } from 'vitest';
import { calculateScore } from '../systems/ScoringSystem';

describe('calculateScore', () => {
  it('awards a top grade for a clean, fast, fully successful mission', () => {
    const result = calculateScore({
      enemiesDestroyed: 2,
      radarDestroyed: true,
      cannonAccuracy: 0.9,
      missilesRemaining: 2,
      playerHealthFraction: 1,
      completionTimeSeconds: 300,
      landedSuccessfully: true,
      civilianStrikes: 0,
    });
    expect(result.score).toBeGreaterThan(4000);
    expect(result.grade).toBe('S');
  });

  it('applies a civilian strike penalty that reduces score', () => {
    const clean = calculateScore({
      enemiesDestroyed: 2,
      radarDestroyed: true,
      cannonAccuracy: 0.5,
      missilesRemaining: 2,
      playerHealthFraction: 0.8,
      completionTimeSeconds: 400,
      landedSuccessfully: true,
      civilianStrikes: 0,
    });
    const withStrikes = calculateScore({
      ...{
        enemiesDestroyed: 2,
        radarDestroyed: true,
        cannonAccuracy: 0.5,
        missilesRemaining: 2,
        playerHealthFraction: 0.8,
        completionTimeSeconds: 400,
        landedSuccessfully: true,
      },
      civilianStrikes: 2,
    });
    expect(withStrikes.score).toBe(clean.score - 600);
  });

  it('never returns a negative score even with heavy penalties', () => {
    const result = calculateScore({
      enemiesDestroyed: 0,
      radarDestroyed: false,
      cannonAccuracy: 0,
      missilesRemaining: 0,
      playerHealthFraction: 0,
      completionTimeSeconds: 5000,
      landedSuccessfully: false,
      civilianStrikes: 10,
    });
    expect(result.score).toBe(0);
    expect(result.grade).toBe('D');
  });

  it('clamps out-of-range inputs instead of producing runaway scores', () => {
    const result = calculateScore({
      enemiesDestroyed: 99,
      radarDestroyed: true,
      cannonAccuracy: 5,
      missilesRemaining: 999,
      playerHealthFraction: 5,
      completionTimeSeconds: 0,
      landedSuccessfully: true,
      civilianStrikes: 0,
    });
    // enemies clamp to 2*1000, accuracy clamps to 1*500, missiles clamp to 4*100, health clamps to 1*400
    expect(result.breakdown.enemies).toBe(2000);
    expect(result.breakdown.accuracy).toBe(500);
    expect(result.breakdown.missiles).toBe(400);
    expect(result.breakdown.health).toBe(400);
  });

  it('grades an unsuccessful landing as C or D regardless of combat performance', () => {
    const result = calculateScore({
      enemiesDestroyed: 2,
      radarDestroyed: true,
      cannonAccuracy: 1,
      missilesRemaining: 4,
      playerHealthFraction: 1,
      completionTimeSeconds: 100,
      landedSuccessfully: false,
      civilianStrikes: 0,
    });
    expect(['C', 'D']).toContain(result.grade);
  });
});
