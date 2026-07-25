import { describe, it, expect } from 'vitest';
import { evaluateLanding } from '../flight/LandingEvaluator';

const goodApproach = {
  gearDown: true,
  speed: 55,
  descentRate: 4,
  lateralOffset: 1,
  headingDiffDeg: 5,
  inArrestingZone: true,
};

describe('evaluateLanding', () => {
  it('succeeds when all forgiving thresholds are met', () => {
    const result = evaluateLanding(goodApproach);
    expect(result.success).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('fails when gear is up', () => {
    const result = evaluateLanding({ ...goodApproach, gearDown: false });
    expect(result.success).toBe(false);
    expect(result.reasons).toContain('gear up');
  });

  it('fails when touchdown happens outside the arresting zone', () => {
    const result = evaluateLanding({ ...goodApproach, inArrestingZone: false });
    expect(result.success).toBe(false);
    expect(result.reasons).toContain('not in arresting zone');
  });

  it('fails on excessive descent rate even if everything else is fine', () => {
    const result = evaluateLanding({ ...goodApproach, descentRate: 25 });
    expect(result.success).toBe(false);
    expect(result.reasons).toContain('descent rate too high');
  });

  it('fails when far off the deck centerline', () => {
    const result = evaluateLanding({ ...goodApproach, lateralOffset: -20 });
    expect(result.success).toBe(false);
    expect(result.reasons).toContain('off centerline');
  });

  it('is forgiving of a moderate heading misalignment', () => {
    const result = evaluateLanding({ ...goodApproach, headingDiffDeg: -30 });
    expect(result.success).toBe(true);
  });

  it('fails when airspeed is far too fast or far too slow', () => {
    expect(evaluateLanding({ ...goodApproach, speed: 150 }).success).toBe(false);
    expect(evaluateLanding({ ...goodApproach, speed: 10 }).success).toBe(false);
  });

  it('accumulates multiple failure reasons at once', () => {
    const result = evaluateLanding({
      gearDown: false,
      speed: 200,
      descentRate: 30,
      lateralOffset: 40,
      headingDiffDeg: 90,
      inArrestingZone: true,
    });
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});
