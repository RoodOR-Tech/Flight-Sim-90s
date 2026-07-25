// Pure procedural height field for the island area.
//
// This module is deliberately free of Three.js and DOM dependencies: the same function that
// generates the visual mesh vertices is the one the collision system queries, which guarantees
// the terrain you can see is exactly the terrain you can crash into. It is also unit-testable.

export interface IslandDefinition {
  cx: number;
  cz: number;
  /** Radius at which the island falls to sea level. */
  radius: number;
  /** Peak height in metres. */
  amplitude: number;
  seed: number;
  /** Higher values produce more, finer ridges. */
  ridgeFrequency: number;
  /** 0..1 — how much of the height comes from sharp ridges vs. smooth hills. */
  ridgeWeight: number;
}

export interface PlateauDefinition {
  cx: number;
  cz: number;
  radius: number;
  /** Absolute height the plateau is flattened to. */
  height: number;
  /** Width of the blend ring outside `radius`. */
  falloff: number;
}

/**
 * Deterministic 2D integer hash → 0..1.
 * Uses Math.imul throughout so all arithmetic stays in 32-bit range and the result is identical
 * across engines (important: the mesh and the collision query must agree exactly).
 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

/** Fractal Brownian motion — layered noise producing smooth rolling hills. */
export function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return value / norm;
}

/**
 * Ridged multifractal noise — folding the noise around its midpoint creates sharp crests,
 * which reads as eroded mountain ridges rather than smooth blobs.
 */
export function ridgedNoise(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(x * freq, y * freq, seed + i * 57);
    const ridge = 1 - Math.abs(n * 2 - 1);
    value += amp * ridge * ridge;
    norm += amp;
    amp *= 0.5;
    freq *= 2.13;
  }
  return value / norm;
}

/**
 * The island area's height field.
 *
 * Height is the max over all island contributions, then plateaus are blended in. Each island
 * combines smooth FBM hills with ridged noise for crests, multiplied by a smooth radial coastline
 * falloff so land always meets the sea cleanly instead of ending in a cliff wall.
 */
export class TerrainField {
  constructor(
    public islands: IslandDefinition[],
    public plateaus: PlateauDefinition[] = [],
  ) {}

  /** Coastline falloff: 1 at the centre, 0 at/beyond the radius, with a soft shoulder. */
  private static falloff(dist: number, radius: number): number {
    if (dist >= radius) return 0;
    const t = 1 - dist / radius;
    // Raised smoothstep keeps interiors broad and tapers the last stretch into the water.
    return smoothstep(Math.min(1, t * 1.35));
  }

  private islandHeight(island: IslandDefinition, x: number, z: number): number {
    const dx = x - island.cx;
    const dz = z - island.cz;
    const dist = Math.hypot(dx, dz);
    const fall = TerrainField.falloff(dist, island.radius);
    if (fall <= 0) return 0;

    const nx = x / island.radius;
    const nz = z / island.radius;
    const hills = fbm(nx * 2.2, nz * 2.2, island.seed, 5);
    const ridges = ridgedNoise(nx * island.ridgeFrequency, nz * island.ridgeFrequency, island.seed + 17, 4);
    const combined = hills * (1 - island.ridgeWeight) + ridges * island.ridgeWeight;

    // Cubed falloff gives a rounded island profile with a flatter shoreline shelf.
    return island.amplitude * combined * fall * fall;
  }

  /** Terrain height at a world position. Returns 0 (sea level) over open water. */
  heightAt(x: number, z: number): number {
    let h = 0;
    for (const island of this.islands) {
      const ih = this.islandHeight(island, x, z);
      if (ih > h) h = ih;
    }

    // Flatten plateaus (e.g. the radar station pad) and blend their edges into the surroundings.
    for (const p of this.plateaus) {
      const dist = Math.hypot(x - p.cx, z - p.cz);
      if (dist <= p.radius) {
        h = p.height;
      } else if (dist < p.radius + p.falloff) {
        const t = smoothstep((dist - p.radius) / p.falloff);
        h = p.height * (1 - t) + h * t;
      }
    }

    return h;
  }

  /**
   * Surface normal from central differences of the height field.
   * `eps` is the sampling distance in metres.
   */
  normalAt(x: number, z: number, eps = 2): { x: number; y: number; z: number } {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    let nx = hL - hR;
    let ny = 2 * eps;
    let nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    return { x: nx, y: ny, z: nz };
  }

  /** Slope in radians (0 = flat, PI/2 = vertical). Used for biome colouring. */
  slopeAt(x: number, z: number, eps = 2): number {
    const n = this.normalAt(x, z, eps);
    return Math.acos(Math.max(-1, Math.min(1, n.y)));
  }

  /** True when the point is above sea level. */
  isLand(x: number, z: number): boolean {
    return this.heightAt(x, z) > 0.15;
  }

  /** Largest island radius, used to size bounding volumes and the tactical map. */
  maxRadius(): number {
    return this.islands.reduce((m, i) => Math.max(m, i.radius), 0);
  }
}
