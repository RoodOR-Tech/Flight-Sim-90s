import {
  ADAPTIVE_COOLDOWN_SECONDS,
  ADAPTIVE_HIGH_FRAME_TIME,
  ADAPTIVE_LOW_FRAME_TIME,
  ADAPTIVE_MIN_PIXEL_RATIO,
  ADAPTIVE_MIN_SAMPLES,
  ADAPTIVE_RATIO_EPSILON,
  ADAPTIVE_SCALE_DOWN_STEP,
  ADAPTIVE_SCALE_UP_STEP,
  FRAME_TIME_RING_SIZE,
} from './RenderConstants';

export interface AdaptiveQualityHost {
  setPixelRatio(ratio: number): void;
}

/**
 * Dynamic-resolution controller.
 *
 * Pattern reference: OpenSkyFlight `js/rendering/AdaptiveQualityManager.js` (MIT) — a frame-time
 * ring buffer with a minimum-sample gate, asymmetric up/down steps and an epsilon deadband so the
 * resolution settles instead of oscillating. Extended here with an explicit cooldown timer, which
 * makes the hysteresis testable and prevents rapid flapping on borderline hardware.
 */
export class AdaptiveQuality {
  private ring = new Float32Array(FRAME_TIME_RING_SIZE);
  private ringIndex = 0;
  private ringFilled = false;
  private cooldown = 0;
  private currentRatio: number;

  constructor(private basePixelRatio: number, private host?: AdaptiveQualityHost) {
    this.currentRatio = basePixelRatio;
  }

  /** Highest ratio adaptive scaling may return to (set when the preset or window changes). */
  setBasePixelRatio(ratio: number) {
    this.basePixelRatio = ratio;
    if (this.currentRatio > ratio) {
      this.currentRatio = ratio;
      this.host?.setPixelRatio(ratio);
    }
  }

  getPixelRatio(): number {
    return this.currentRatio;
  }

  getAverageFrameTime(): number {
    const count = this.sampleCount();
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.ring[i];
    return sum / count;
  }

  private sampleCount(): number {
    return this.ringFilled ? FRAME_TIME_RING_SIZE : this.ringIndex;
  }

  reset() {
    this.ringIndex = 0;
    this.ringFilled = false;
    this.cooldown = 0;
  }

  /**
   * Records a frame and possibly adjusts resolution.
   * @returns the pixel ratio in force after this update.
   */
  update(frameTimeMs: number, dt: number): number {
    this.ring[this.ringIndex] = frameTimeMs;
    this.ringIndex = (this.ringIndex + 1) % FRAME_TIME_RING_SIZE;
    if (this.ringIndex === 0) this.ringFilled = true;

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.sampleCount() < ADAPTIVE_MIN_SAMPLES) return this.currentRatio;
    if (this.cooldown > 0) return this.currentRatio;

    const avg = this.getAverageFrameTime();
    let target = this.currentRatio;
    if (avg > ADAPTIVE_HIGH_FRAME_TIME) {
      target = Math.max(ADAPTIVE_MIN_PIXEL_RATIO, this.currentRatio - ADAPTIVE_SCALE_DOWN_STEP);
    } else if (avg < ADAPTIVE_LOW_FRAME_TIME) {
      target = Math.min(this.basePixelRatio, this.currentRatio + ADAPTIVE_SCALE_UP_STEP);
    }

    if (Math.abs(target - this.currentRatio) > ADAPTIVE_RATIO_EPSILON) {
      this.currentRatio = target;
      this.host?.setPixelRatio(target);
      this.cooldown = ADAPTIVE_COOLDOWN_SECONDS;
      // Clear history so the next decision is based on the new resolution's cost.
      this.ringIndex = 0;
      this.ringFilled = false;
    }
    return this.currentRatio;
  }
}
