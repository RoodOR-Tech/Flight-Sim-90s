import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { AssetLoader } from '../rendering/AssetLoader';

// Port 1 refuses connections immediately, so these loads fail fast and deterministically instead
// of depending on how Node resolves a relative asset path.
const UNREACHABLE = 'http://127.0.0.1:1/';

/**
 * The central guarantee under test: a missing or broken optional asset must never reject, and must
 * always yield usable fallback geometry, so the mission can still start.
 */
describe('AssetLoader fallback and caching', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The loader intentionally warns when an optional asset is absent; keep test output readable.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeFallback(name: string) {
    return () => {
      const obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      obj.name = name;
      return obj;
    };
  }

  it('resolves with the fallback when the model file does not exist', async () => {
    const loader = new AssetLoader();
    loader.setTotalSteps(1);
    const result = await loader.loadModel({
      id: 'missing.model',
      url: UNREACHABLE + 'not-here.glb',
      fallback: makeFallback('fallback-a'),
    });
    expect(result.usedFallback).toBe(true);
    expect(result.object.name).toBe('fallback-a');
    expect(result.source).toContain('fallback');
  });

  it('never rejects on a failed load', async () => {
    const loader = new AssetLoader();
    loader.setTotalSteps(1);
    await expect(
      loader.loadModel({
        id: 'broken',
        url: UNREACHABLE + 'nope.glb',
        fallback: makeFallback('fallback-b'),
      }),
    ).resolves.toBeDefined();
  });

  it('logs a clear warning naming the asset that could not be loaded', async () => {
    const loader = new AssetLoader();
    loader.setTotalSteps(1);
    await loader.loadModel({
      id: 'aircraft.sea-viper',
      url: UNREACHABLE + 'assets/aircraft/sea-viper/sea-viper.glb',
      fallback: makeFallback('fallback-c'),
    });
    expect(warnSpy).toHaveBeenCalled();
    const messages = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toContain('sea-viper.glb');
    expect(messages).toContain('fallback');
  });

  it('remembers a failure and does not retry the network on the next request', async () => {
    const loader = new AssetLoader();
    loader.setTotalSteps(2);
    const first = await loader.loadModel({
      id: 'same.id',
      url: UNREACHABLE + 'nope.glb',
      fallback: makeFallback('f1'),
    });
    const second = await loader.loadModel({
      id: 'same.id',
      url: UNREACHABLE + 'nope.glb',
      fallback: makeFallback('f2'),
    });
    expect(first.usedFallback).toBe(true);
    expect(second.usedFallback).toBe(true);
    expect(second.source).toContain('cached-failure');
  });

  it('builds a fresh fallback instance per request so entities never share one object', async () => {
    const loader = new AssetLoader();
    loader.setTotalSteps(2);
    const a = await loader.loadModel({ id: 'x', url: UNREACHABLE + 'no.glb', fallback: makeFallback('shared') });
    const b = await loader.loadModel({ id: 'y', url: UNREACHABLE + 'no.glb', fallback: makeFallback('shared') });
    expect(a.object).not.toBe(b.object);
  });

  it('reports progress across the declared number of steps', async () => {
    const loader = new AssetLoader();
    const seen: Array<{ loaded: number; total: number }> = [];
    loader.onProgress((p) => seen.push({ loaded: p.loaded, total: p.total }));
    loader.setTotalSteps(3);

    await loader.loadModel({ id: 'a', url: UNREACHABLE + 'no.glb', fallback: makeFallback('a') });
    await loader.loadModel({ id: 'b', url: UNREACHABLE + 'no.glb', fallback: makeFallback('b') });
    loader.completeStep('final');

    expect(seen.length).toBeGreaterThanOrEqual(3);
    const last = seen[seen.length - 1];
    expect(last.total).toBe(3);
    expect(last.loaded).toBe(3);
  });

  it('never reports progress beyond the declared total', async () => {
    const loader = new AssetLoader();
    const seen: number[] = [];
    loader.onProgress((p) => seen.push(p.loaded / p.total));
    loader.setTotalSteps(1);
    loader.completeStep('one');
    loader.completeStep('two');
    loader.completeStep('three');
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it('returns null for a missing texture rather than throwing', async () => {
    const loader = new AssetLoader();
    const tex = await loader.loadTexture(UNREACHABLE + 'textures/not-there.png');
    expect(tex).toBeNull();
  });
});
