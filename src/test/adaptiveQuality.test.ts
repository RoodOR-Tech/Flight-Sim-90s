import { describe, it, expect } from 'vitest';
import { AdaptiveQuality } from '../rendering/AdaptiveQuality';
import {
  ADAPTIVE_COOLDOWN_SECONDS,
  ADAPTIVE_HIGH_FRAME_TIME,
  ADAPTIVE_LOW_FRAME_TIME,
  ADAPTIVE_MIN_PIXEL_RATIO,
  ADAPTIVE_MIN_SAMPLES,
  ADAPTIVE_SCALE_DOWN_STEP,
  ADAPTIVE_SCALE_UP_STEP,
} from '../rendering/RenderConstants';

function makeHost() {
  const calls: number[] = [];
  return { host: { setPixelRatio: (r: number) => calls.push(r) }, calls };
}

/** Feeds `frames` frames of the given frame time, advancing time by that amount each frame. */
function feed(aq: AdaptiveQuality, frameTimeMs: number, frames: number) {
  for (let i = 0; i < frames; i++) {
    aq.update(frameTimeMs, frameTimeMs / 1000);
  }
}

/**
 * Fills the ring buffer with a consistent frame time at zero elapsed time.
 * Zero dt means the cooldown cannot tick down during the fill, so this permits *at most one*
 * decision — and only if the cooldown was already clear.
 */
function fillRing(aq: AdaptiveQuality, frameTimeMs: number) {
  for (let i = 0; i < ADAPTIVE_MIN_SAMPLES; i++) {
    aq.update(frameTimeMs, 0);
  }
}

/**
 * Submits one frame carrying enough elapsed time to expire an active cooldown.
 * A decision cannot fire on this call, because the preceding decision cleared the ring.
 */
function clearCooldown(aq: AdaptiveQuality, frameTimeMs: number) {
  aq.update(frameTimeMs, ADAPTIVE_COOLDOWN_SECONDS + 0.01);
}

/** One complete decision cycle: make a decision, then let its cooldown expire. */
function decide(aq: AdaptiveQuality, frameTimeMs: number) {
  fillRing(aq, frameTimeMs);
  clearCooldown(aq, frameTimeMs);
}

describe('AdaptiveQuality', () => {
  it('starts at the base pixel ratio', () => {
    const aq = new AdaptiveQuality(2);
    expect(aq.getPixelRatio()).toBe(2);
  });

  it('does not adjust before the minimum sample count is reached', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);
    feed(aq, 40, ADAPTIVE_MIN_SAMPLES - 1);
    expect(calls).toHaveLength(0);
    expect(aq.getPixelRatio()).toBe(2);
  });

  it('scales resolution down when frame times are consistently slow', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);
    fillRing(aq, ADAPTIVE_HIGH_FRAME_TIME + 12);
    expect(calls.length).toBe(1);
    expect(aq.getPixelRatio()).toBeCloseTo(2 - ADAPTIVE_SCALE_DOWN_STEP, 5);
  });

  it('never scales below the configured floor', () => {
    const aq = new AdaptiveQuality(2);
    // Many consecutive decisions on very slow frames.
    for (let i = 0; i < 60; i++) decide(aq, 120);
    // The floor is a hard bound. It may settle up to one deadband short of it, because a change
    // smaller than the epsilon is intentionally not applied.
    expect(aq.getPixelRatio()).toBeGreaterThanOrEqual(ADAPTIVE_MIN_PIXEL_RATIO);
    expect(aq.getPixelRatio()).toBeLessThan(ADAPTIVE_MIN_PIXEL_RATIO + ADAPTIVE_SCALE_DOWN_STEP);
  });

  it('never scales above the base pixel ratio', () => {
    const aq = new AdaptiveQuality(1.5);
    for (let i = 0; i < 60; i++) decide(aq, 4);
    expect(aq.getPixelRatio()).toBeLessThanOrEqual(1.5);
    expect(aq.getPixelRatio()).toBeGreaterThan(1.5 - ADAPTIVE_SCALE_UP_STEP - 1e-9);
  });

  it('recovers resolution gradually once frame times improve', () => {
    const aq = new AdaptiveQuality(2);

    // Several slow decisions to bring the resolution down.
    for (let i = 0; i < 5; i++) decide(aq, ADAPTIVE_HIGH_FRAME_TIME + 12);
    const dropped = aq.getPixelRatio();
    expect(dropped).toBeLessThan(2);

    // Clear the sampling window so the recovery decision is judged purely on fast frames — a
    // freshly-improved workload, rather than an average still weighted by the slow history.
    aq.reset();
    fillRing(aq, ADAPTIVE_LOW_FRAME_TIME - 4);

    expect(aq.getPixelRatio()).toBeGreaterThan(dropped);
    // Recovery is deliberately slower than degradation, and happens one step at a time.
    expect(ADAPTIVE_SCALE_UP_STEP).toBeLessThan(ADAPTIVE_SCALE_DOWN_STEP);
    expect(aq.getPixelRatio() - dropped).toBeCloseTo(ADAPTIVE_SCALE_UP_STEP, 5);
  });

  it('weights its decision on the recent average, not a single frame', () => {
    const aq = new AdaptiveQuality(2);
    // A ring dominated by slow frames must not scale up just because the latest frame was fast.
    fillRing(aq, ADAPTIVE_HIGH_FRAME_TIME + 12);
    const afterDrop = aq.getPixelRatio();
    aq.update(1, ADAPTIVE_COOLDOWN_SECONDS + 0.01);
    expect(aq.getPixelRatio()).toBe(afterDrop);
  });

  it('applies hysteresis: it will not change again within the cooldown window', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);

    fillRing(aq, ADAPTIVE_HIGH_FRAME_TIME + 12);
    expect(calls.length).toBe(1);

    // Hammer it with slow frames but never let the cooldown elapse (dt = 0).
    for (let i = 0; i < 500; i++) {
      aq.update(ADAPTIVE_HIGH_FRAME_TIME + 12, 0);
    }
    expect(calls.length).toBe(1);
  });

  it('makes at most one change per cooldown period under sustained load', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);
    // 5 cooldown periods worth of slow frames.
    for (let i = 0; i < 5; i++) decide(aq, ADAPTIVE_HIGH_FRAME_TIME + 12);
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it('does not oscillate when frame times sit between the two thresholds', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);
    const between = (ADAPTIVE_HIGH_FRAME_TIME + ADAPTIVE_LOW_FRAME_TIME) / 2;
    for (let i = 0; i < 300; i++) {
      aq.update(between, 0.016);
    }
    expect(calls).toHaveLength(0);
    expect(aq.getPixelRatio()).toBe(2);
  });

  it('clamps the current ratio down when the base ratio is lowered', () => {
    const { host, calls } = makeHost();
    const aq = new AdaptiveQuality(2, host);
    aq.setBasePixelRatio(1);
    expect(aq.getPixelRatio()).toBe(1);
    expect(calls).toContain(1);
  });

  it('reports a rolling average frame time', () => {
    const aq = new AdaptiveQuality(1);
    feed(aq, 10, 5);
    expect(aq.getAverageFrameTime()).toBeCloseTo(10, 5);
  });
});
