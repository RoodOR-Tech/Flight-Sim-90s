import * as THREE from 'three';

// Every texture in this game is generated at runtime on a canvas or as a DataTexture.
// No image files are downloaded or bundled, which keeps asset licensing unambiguous.
// Generation is deterministic (seeded PRNG, no Math.random) so builds look identical.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, THREE.Texture>();

function cached(key: string, build: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = build();
  cache.set(key, tex);
  return tex;
}

/**
 * Cache wrapper for canvas-drawn textures. Falls back to a flat stub colour when no 2D canvas is
 * available (Node unit tests) or if drawing throws, so model construction never fails outright.
 */
function cachedCanvas(key: string, stubColor: number, build: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  let tex: THREE.Texture;
  if (!canvasAvailable()) {
    tex = makeStubTexture(stubColor);
  } else {
    try {
      tex = build();
    } catch (err) {
      console.warn(`[ProceduralTextures] Could not generate "${key}"; using a flat colour.`, err);
      tex = makeStubTexture(stubColor);
    }
  }
  cache.set(key, tex);
  return tex;
}

/** True when a usable 2D canvas is available (false under Node/headless unit tests). */
function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * A 1x1 texture stand-in used when no canvas is available (e.g. Node unit tests).
 * Materials still construct correctly; only the visual detail is absent.
 */
function makeStubTexture(color = 0xffffff): THREE.DataTexture {
  const data = new Uint8Array([
    (color >> 16) & 0xff,
    (color >> 8) & 0xff,
    color & 0xff,
    255,
  ]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

/** Value-noise + FBM helper shared by the texture builders. */
function fbmSampler(seed: number, octaves = 4) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const hash = (x: number, y: number) => perm[(perm[x & 255] + (y & 255)) & 511] / 255;

  const smooth = (t: number) => t * t * (3 - 2 * t);

  function noise(px: number, py: number): number {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const sx = smooth(fx);
    const sy = smooth(fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
  }

  return function fbm(px: number, py: number): number {
    let value = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += amp * noise(px * freq, py * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return value / norm;
  };
}

/**
 * Single-channel FBM noise as a tiling DataTexture.
 *
 * Pattern reference: OpenSkyFlight `js/atmosphere/CloudLayer.js` (MIT) pre-computes FBM on the
 * CPU into a texture rather than evaluating a 5-octave FBM per pixel in the shader. Reused here
 * for both the cloud sprites and the terrain/water detail.
 */
export function getNoiseTexture(size = 256, seed = 1337, scale = 6, octaves = 5): THREE.DataTexture {
  const key = `noise-${size}-${seed}-${scale}-${octaves}`;
  return cached(key, () => {
    const fbm = fbmSampler(seed, octaves);
    const data = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        data[y * size + x] = Math.round(fbm((x / size) * scale, (y / size) * scale) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.DataTexture;
}

/**
 * Tiling normal map for the ocean surface, derived from the height gradient of two offset
 * FBM fields. Replaces the `waternormals.jpg` that Three's Water example normally loads,
 * so no third-party image is required.
 */
export function getWaterNormalTexture(size = 256): THREE.DataTexture {
  return cached(`water-normal-${size}`, () => {
    const fbmA = fbmSampler(4242, 4);
    const fbmB = fbmSampler(909, 3);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 8;
        const v = (y / size) * 8;
        height[y * size + x] = fbmA(u, v) * 0.65 + fbmB(u * 2.3, v * 2.3) * 0.35;
      }
    }

    const data = new Uint8Array(size * size * 4);
    const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
    const strength = 2.4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        // Normal from gradient, packed into [0,1]
        let nx = -dx;
        let ny = -dy;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * size + x) * 4;
        data[i] = Math.round((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        data[i + 3] = 255;
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }) as THREE.DataTexture;
}

/**
 * Carrier flight-deck texture: worn non-skid grey with centreline, catapult track, landing-area
 * lines, arresting-wire marks and deck numbers. Drawn once onto a canvas.
 */
export function getCarrierDeckTexture(anisotropy = 4): THREE.Texture {
  return cachedCanvas(`carrier-deck-${anisotropy}`, 0x5f666a, () => {
    const size = 1024;
    const { canvas, ctx } = makeCanvas(size);
    const rand = mulberry32(77);

    // Base non-skid surface
    ctx.fillStyle = '#5f666a';
    ctx.fillRect(0, 0, size, size);

    // Mottled wear
    for (let i = 0; i < 5200; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 1 + rand() * 8;
      const shade = 84 + Math.floor(rand() * 40);
      ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 5},${0.16 + rand() * 0.22})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Faint panel seams across the deck
    ctx.strokeStyle = 'rgba(30,34,36,0.35)';
    ctx.lineWidth = 2;
    for (let y = 0; y < size; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y + rand() * 3);
      ctx.lineTo(size, y + rand() * 3);
      ctx.stroke();
    }

    // Landing-area centreline (runs along V of the texture)
    ctx.strokeStyle = '#e6e9ea';
    ctx.lineWidth = 14;
    ctx.setLineDash([70, 46]);
    ctx.beginPath();
    ctx.moveTo(size * 0.52, 0);
    ctx.lineTo(size * 0.52, size);
    ctx.stroke();
    ctx.setLineDash([]);

    // Solid landing-area edge stripes
    ctx.strokeStyle = 'rgba(232,236,237,0.9)';
    ctx.lineWidth = 8;
    for (const x of [size * 0.3, size * 0.74]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    // Catapult track (yellow-bordered dark slot) on the port side
    ctx.fillStyle = '#2a2c2d';
    ctx.fillRect(size * 0.1, 0, 26, size);
    ctx.strokeStyle = '#e2c53a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(size * 0.1 - 10, 0);
    ctx.lineTo(size * 0.1 - 10, size);
    ctx.moveTo(size * 0.1 + 36, 0);
    ctx.lineTo(size * 0.1 + 36, size);
    ctx.stroke();

    // Arresting-wire hash marks
    ctx.strokeStyle = 'rgba(240,240,235,0.85)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      const y = size * (0.58 + i * 0.085);
      ctx.beginPath();
      ctx.moveTo(size * 0.32, y);
      ctx.lineTo(size * 0.72, y);
      ctx.stroke();
    }

    // Foul-line (red dashed safety boundary)
    ctx.strokeStyle = 'rgba(200,64,52,0.8)';
    ctx.lineWidth = 5;
    ctx.setLineDash([26, 20]);
    ctx.beginPath();
    ctx.moveTo(size * 0.2, 0);
    ctx.lineTo(size * 0.2, size);
    ctx.stroke();
    ctx.setLineDash([]);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  });
}

/** Grey hull/superstructure plating with rivet rows and streaking. */
export function getHullTexture(): THREE.Texture {
  return cachedCanvas('hull', 0x3f464b, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rand = mulberry32(23);
    ctx.fillStyle = '#565e64';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1400; i++) {
      const shade = 76 + Math.floor(rand() * 34);
      ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 7},0.2)`;
      ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 26, 1 + rand() * 4);
    }
    // Plate seams
    ctx.strokeStyle = 'rgba(26,30,33,0.5)';
    ctx.lineWidth = 1.5;
    for (let y = 0; y < size; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    for (let x = 0; x < size; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    // Rust streaks running down the hull
    for (let i = 0; i < 40; i++) {
      const x = rand() * size;
      const h = 30 + rand() * 120;
      const grad = ctx.createLinearGradient(x, 0, x, h);
      grad.addColorStop(0, 'rgba(96,60,38,0.28)');
      grad.addColorStop(1, 'rgba(96,60,38,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, rand() * size, 2 + rand() * 4, h);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

/** Aircraft skin: subtle panel lines and shading variation over a base colour. */
export function getAircraftPanelTexture(baseColor: string, seed: number): THREE.Texture {
  return cachedCanvas(`panel-${baseColor}-${seed}`, 0x6a737a, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const rand = mulberry32(seed);
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    // Broad tonal variation so large flat surfaces are not perfectly uniform
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + rand() * 0.03})`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 20 + rand() * 90, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.012 + rand() * 0.035})`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 16 + rand() * 70, 0, Math.PI * 2);
      ctx.fill();
    }

    // Panel lines
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 1.4;
    for (let y = 34; y < size; y += 52 + Math.floor(rand() * 22)) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rand() - 0.5) * 8);
      ctx.stroke();
    }
    for (let x = 40; x < size; x += 66 + Math.floor(rand() * 30)) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rand() - 0.5) * 8, size);
      ctx.stroke();
    }
    // Access hatches
    for (let i = 0; i < 16; i++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.2;
      const w = 16 + rand() * 30;
      const h = 12 + rand() * 20;
      ctx.strokeRect(rand() * (size - w), rand() * (size - h), w, h);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

/** Rough rock/soil surface for islands and coastal cliffs. */
export function getRockTexture(): THREE.Texture {
  return cachedCanvas('rock', 0x6f6858, () => {
    const size = 512;
    const { canvas, ctx } = makeCanvas(size);
    const fbm = fbmSampler(555, 5);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm((x / size) * 9, (y / size) * 9);
        const detail = fbm((x / size) * 34, (y / size) * 34) * 0.3;
        const v = n * 0.7 + detail;
        const i = (y * size + x) * 4;
        img.data[i] = Math.round(88 + v * 74);
        img.data[i + 1] = Math.round(82 + v * 66);
        img.data[i + 2] = Math.round(68 + v * 52);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

/** Poured-concrete surface for the radar plateau and structures. */
export function getConcreteTexture(): THREE.Texture {
  return cachedCanvas('concrete', 0x8b8b84, () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size);
    const rand = mulberry32(31);
    ctx.fillStyle = '#8b8b84';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4200; i++) {
      const shade = 118 + Math.floor(rand() * 44);
      ctx.fillStyle = `rgba(${shade},${shade},${shade - 6},${0.1 + rand() * 0.2})`;
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 3);
    }
    ctx.strokeStyle = 'rgba(70,70,66,0.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= size; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

/** Soft round particle sprite used by smoke, explosions and wake. */
export function getSoftParticleTexture(): THREE.Texture {
  return cachedCanvas('soft-particle', 0xffffff, () => {
    const size = 64;
    const { canvas, ctx } = makeCanvas(size);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  });
}

/**
 * Irregular puffy cloud sprite. Built from overlapping soft lobes so the sprite silhouette
 * is not an obvious circle or rectangle at the edges.
 */
export function getCloudSpriteTexture(variant = 0): THREE.Texture {
  return cachedCanvas(`cloud-sprite-${variant}`, 0xf2f5f7, () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size);
    const rand = mulberry32(1000 + variant * 37);
    ctx.clearRect(0, 0, size, size);

    const lobes = 13;
    for (let i = 0; i < lobes; i++) {
      // Cluster lobes toward the centre, flatter horizontally, denser at the base.
      const cx = size * (0.5 + (rand() - 0.5) * 0.62);
      const cy = size * (0.56 + (rand() - 0.5) * 0.38);
      const r = size * (0.1 + rand() * 0.17);
      const grad = ctx.createRadialGradient(cx, cy - r * 0.25, r * 0.1, cx, cy, r);
      const brightness = 236 + Math.floor(rand() * 19);
      grad.addColorStop(0, `rgba(${brightness},${brightness},${brightness},0.95)`);
      grad.addColorStop(0.55, `rgba(${brightness - 12},${brightness - 8},${brightness - 4},0.45)`);
      grad.addColorStop(1, 'rgba(220,226,232,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.25, r * 0.88, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fade the outer border to fully transparent so no sprite edge can show.
    const vign = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.5);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

export function disposeProceduralTextures() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
