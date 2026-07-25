import * as THREE from 'three';

export interface PerformanceSnapshot {
  fps: number;
  frameTimeMs: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  activeParticles: number;
  activeMissiles: number;
  terrainDetail: string;
  quality: string;
}

/**
 * Rolling frame-time / renderer statistics plus an optional on-screen overlay.
 *
 * Pattern reference: OpenSkyFlight `js/benchmark/MetricsCollector.js` (MIT) — sampling
 * `renderer.info` for draw calls and triangles, and timing named subsystems within a frame.
 */
export class PerformanceMonitor {
  private el: HTMLElement;
  private accum = 0;
  private frames = 0;
  private fps = 0;
  private lastFrameTime = 0;
  private subsystemStarts = new Map<string, number>();
  private subsystemTimes = new Map<string, number>();
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'perf-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  beginSubsystem(name: string) {
    if (!this.visible) return;
    this.subsystemStarts.set(name, performance.now());
  }

  endSubsystem(name: string) {
    if (!this.visible) return;
    const start = this.subsystemStarts.get(name);
    if (start !== undefined) {
      this.subsystemTimes.set(name, performance.now() - start);
      this.subsystemStarts.delete(name);
    }
  }

  /** Call once per rendered frame. */
  sample(dt: number, frameTimeMs: number) {
    this.lastFrameTime = frameTimeMs;
    this.accum += dt;
    this.frames += 1;
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      this.frames = 0;
      this.accum = 0;
    }
  }

  getFps(): number {
    return this.fps;
  }

  snapshot(renderer: THREE.WebGLRenderer, extra: Partial<PerformanceSnapshot>): PerformanceSnapshot {
    const info = renderer.info;
    return {
      fps: Math.round(this.fps),
      frameTimeMs: Math.round(this.lastFrameTime * 100) / 100,
      pixelRatio: Math.round(renderer.getPixelRatio() * 100) / 100,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      activeParticles: 0,
      activeMissiles: 0,
      terrainDetail: 'n/a',
      quality: 'n/a',
      ...extra,
    };
  }

  render(renderer: THREE.WebGLRenderer, extra: Partial<PerformanceSnapshot>) {
    if (!this.visible) return;
    const s = this.snapshot(renderer, extra);
    const subs = [...this.subsystemTimes.entries()]
      .map(([k, v]) => `${k} ${v.toFixed(1)}ms`)
      .join('  ');
    this.el.innerHTML = `
      <div><b>${s.fps} FPS</b> &nbsp; ${s.frameTimeMs.toFixed(1)} ms</div>
      <div>DPR ${s.pixelRatio}  &nbsp; QUALITY ${s.quality}</div>
      <div>draws ${s.drawCalls} &nbsp; tris ${s.triangles.toLocaleString()}</div>
      <div>programs ${s.programs}</div>
      <div>particles ${s.activeParticles} &nbsp; missiles ${s.activeMissiles}</div>
      <div>terrain ${s.terrainDetail}</div>
      ${subs ? `<div>${subs}</div>` : ''}
    `;
  }

  dispose() {
    this.el.remove();
  }
}
