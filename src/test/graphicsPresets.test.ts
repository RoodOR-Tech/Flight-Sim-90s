import { describe, it, expect } from 'vitest';
import { PRESETS, resolvePreset, GraphicsSettings } from '../rendering/GraphicsPresets';

describe('graphics presets', () => {
  it('defines low, medium and high', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['high', 'low', 'medium']);
  });

  it('disables every expensive feature on Low', () => {
    const low = PRESETS.low;
    expect(low.shadowsEnabled).toBe(false);
    expect(low.reflectiveWater).toBe(false);
    expect(low.postProcessing).toBe(false);
    expect(low.bloom).toBe(false);
    expect(low.antialiasPass).toBe(false);
    expect(low.maxPixelRatio).toBeLessThanOrEqual(1);
  });

  it('increases cost monotonically from low through high', () => {
    const keys: Array<keyof GraphicsSettings> = [
      'maxPixelRatio',
      'shadowMapSize',
      'cloudCount',
      'particleScale',
      'terrainSegments',
      'anisotropy',
      'propCullDistance',
      'waterReflectionResolution',
    ];
    for (const key of keys) {
      const low = PRESETS.low[key] as number;
      const med = PRESETS.medium[key] as number;
      const high = PRESETS.high[key] as number;
      expect(med, `${key} medium >= low`).toBeGreaterThanOrEqual(low);
      expect(high, `${key} high >= medium`).toBeGreaterThanOrEqual(med);
    }
  });

  it('resolves a named preset to a copy, not a shared reference', () => {
    const a = resolvePreset('high');
    const b = resolvePreset('high');
    expect(a).toEqual(PRESETS.high);
    a.cloudCount = 999;
    // Mutating a resolved preset must not corrupt the table or other resolutions.
    expect(b.cloudCount).not.toBe(999);
    expect(PRESETS.high.cloudCount).not.toBe(999);
  });

  it('resolves auto to one of the concrete presets', () => {
    const auto = resolvePreset('auto');
    const matchesSome = (['low', 'medium', 'high'] as const).some(
      (k) => JSON.stringify(auto) === JSON.stringify(PRESETS[k]),
    );
    expect(matchesSome).toBe(true);
  });

  it('keeps particle scale within a sane 0..1 range', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset.particleScale).toBeGreaterThan(0);
      expect(preset.particleScale).toBeLessThanOrEqual(1);
    }
  });
});
