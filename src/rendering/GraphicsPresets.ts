export type GraphicsQuality = 'auto' | 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  /** Upper bound on renderer pixel ratio. */
  maxPixelRatio: number;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  /** Use the reflective Water shader; false falls back to a cheap animated standard material. */
  reflectiveWater: boolean;
  waterReflectionResolution: number;
  cloudCount: number;
  /** Multiplier applied to effect particle budgets. */
  particleScale: number;
  postProcessing: boolean;
  bloom: boolean;
  antialiasPass: boolean;
  vignette: boolean;
  /** Terrain heightfield resolution (segments per side). */
  terrainSegments: number;
  anisotropy: number;
  /** Distance beyond which decorative props are culled. */
  propCullDistance: number;
}

export const PRESETS: Record<Exclude<GraphicsQuality, 'auto'>, GraphicsSettings> = {
  low: {
    maxPixelRatio: 1,
    shadowsEnabled: false,
    shadowMapSize: 512,
    reflectiveWater: false,
    waterReflectionResolution: 128,
    cloudCount: 8,
    particleScale: 0.5,
    postProcessing: false,
    bloom: false,
    antialiasPass: false,
    vignette: false,
    terrainSegments: 96,
    anisotropy: 1,
    propCullDistance: 2600,
  },
  medium: {
    maxPixelRatio: 1.5,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    reflectiveWater: true,
    waterReflectionResolution: 256,
    cloudCount: 16,
    particleScale: 0.85,
    postProcessing: true,
    bloom: true,
    antialiasPass: true,
    vignette: true,
    terrainSegments: 160,
    anisotropy: 4,
    propCullDistance: 4200,
  },
  high: {
    maxPixelRatio: 2,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    reflectiveWater: true,
    waterReflectionResolution: 512,
    cloudCount: 26,
    particleScale: 1,
    postProcessing: true,
    bloom: true,
    antialiasPass: true,
    vignette: true,
    terrainSegments: 224,
    anisotropy: 8,
    propCullDistance: 6500,
  },
};

/**
 * Picks a starting preset for 'auto' from coarse device hints. Adaptive resolution then
 * fine-tunes at runtime, so this only needs to be roughly right.
 */
export function detectAutoPreset(): Exclude<GraphicsQuality, 'auto'> {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const mem = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory ?? 8 : 8;
  if (cores <= 4 || mem <= 4) return 'low';
  if (cores <= 8 && dpr > 2) return 'medium';
  return cores >= 8 ? 'high' : 'medium';
}

export function resolvePreset(quality: GraphicsQuality): GraphicsSettings {
  if (quality === 'auto') return { ...PRESETS[detectAutoPreset()] };
  return { ...PRESETS[quality] };
}
