import * as THREE from 'three';
import { GraphicsSettings } from './GraphicsPresets';

/**
 * Optional postprocessing pipeline (SMAA antialiasing + restrained bloom + vignette).
 *
 * Every part of this is best-effort. The `postprocessing` package is imported dynamically and the
 * whole construction is wrapped in try/catch, because a WebGL feature gap or a shader compile
 * failure must degrade to plain forward rendering rather than leaving the player on a blank canvas.
 *
 * Call `render()` each frame; it returns true if it composited, false if the caller should fall
 * back to `renderer.render(scene, camera)`.
 */
export class PostProcessing {
  private composer: any | null = null;
  private bloomEffect: any | null = null;
  private vignetteEffect: any | null = null;
  private enabled = false;
  private failed = false;

  private constructor() {}

  static async create(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    settings: GraphicsSettings,
  ): Promise<PostProcessing> {
    const pp = new PostProcessing();
    if (!settings.postProcessing) return pp;
    await pp.build(renderer, scene, camera, settings);
    return pp;
  }

  private async build(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    settings: GraphicsSettings,
  ) {
    try {
      const mod = await import('postprocessing');
      const { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, VignetteEffect, BlendFunction } = mod as any;

      const composer = new EffectComposer(renderer, {
        // Half-float avoids banding in the bloom pass while staying cheap.
        frameBufferType: THREE.HalfFloatType,
      });
      composer.addPass(new RenderPass(scene, camera));

      const effects: any[] = [];

      if (settings.antialiasPass) {
        effects.push(new SMAAEffect());
      }

      if (settings.bloom) {
        // Restrained bloom: a high threshold so only genuinely bright things (afterburners,
        // explosions, sun glint) glow, rather than washing the whole frame.
        this.bloomEffect = new BloomEffect({
          intensity: 0.72,
          luminanceThreshold: 0.72,
          luminanceSmoothing: 0.24,
          mipmapBlur: true,
          radius: 0.55,
        });
        effects.push(this.bloomEffect);
      }

      if (settings.vignette) {
        this.vignetteEffect = new VignetteEffect({
          blendFunction: BlendFunction.NORMAL,
          offset: 0.32,
          darkness: 0.42,
        });
        effects.push(this.vignetteEffect);
      }

      if (effects.length > 0) {
        composer.addPass(new EffectPass(camera, ...effects));
      }

      composer.setSize(window.innerWidth, window.innerHeight);
      this.composer = composer;
      this.enabled = true;
    } catch (err) {
      console.warn(
        '[PostProcessing] Pipeline unavailable; falling back to direct rendering. The game is fully playable without it.',
        err instanceof Error ? err.message : err,
      );
      this.failed = true;
      this.enabled = false;
      this.composer = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.composer !== null;
  }

  hasFailed(): boolean {
    return this.failed;
  }

  setSize(width: number, height: number) {
    try {
      this.composer?.setSize(width, height);
    } catch {
      // A resize failure should not kill the frame loop.
    }
  }

  /** @returns true when the frame was composited here. */
  render(dt: number): boolean {
    if (!this.isEnabled()) return false;
    try {
      this.composer.render(dt);
      return true;
    } catch (err) {
      console.warn('[PostProcessing] Render failed; disabling the pipeline.', err);
      this.enabled = false;
      return false;
    }
  }

  dispose() {
    try {
      this.composer?.dispose();
    } catch {
      // Ignore disposal errors on teardown.
    }
    this.composer = null;
    this.enabled = false;
  }
}
