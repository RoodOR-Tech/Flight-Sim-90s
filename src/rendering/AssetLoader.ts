import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ModelTransformConfig, applyModelTransform, normalizeModelSize } from './ModelTransform';

export interface AssetProgress {
  /** Human-readable stage label shown on the loading screen. */
  label: string;
  loaded: number;
  total: number;
}

export interface ModelRequest {
  /** Cache key and diagnostic name. */
  id: string;
  /** URL under `public/`. May legitimately not exist — the fallback is then used. */
  url: string;
  /** Target length along the longest axis, in metres. Omit to skip auto-fit. */
  targetLength?: number;
  transform?: ModelTransformConfig;
  /** Built when the GLB is absent or fails to load. Must always succeed. */
  fallback: () => THREE.Object3D;
}

export interface LoadedModel {
  object: THREE.Object3D;
  /** True when the object came from the procedural fallback rather than a GLB. */
  usedFallback: boolean;
  source: string;
}

/**
 * Centralized model/texture loading with caching, optional compression support, and a mandatory
 * procedural fallback for every asset.
 *
 * Design rule: **a missing or broken optional asset must never stop the mission from starting.**
 * `loadModel` therefore resolves rather than rejects on failure, logging a clear warning and
 * returning the fallback object.
 *
 * Pattern reference: OpenSkyFlight `js/aircraft/AircraftManager.js` (MIT) for the GLTF load +
 * bounding-box normalization + `frustumCulled` handling. The cache, fallback contract, Draco/KTX2
 * wiring and disposal here are additions for this project.
 */
export class AssetLoader {
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader | null = null;
  private ktx2Loader: KTX2Loader | null = null;
  private textureLoader = new THREE.TextureLoader();

  /** Cached source scenes, cloned per instance request. */
  private modelCache = new Map<string, THREE.Object3D>();
  private textureCache = new Map<string, THREE.Texture>();
  private failed = new Set<string>();

  private progressListeners: Array<(p: AssetProgress) => void> = [];
  private loadedCount = 0;
  private totalCount = 0;
  private currentLabel = 'Initializing';

  constructor(private renderer?: THREE.WebGLRenderer) {
    this.gltfLoader = new GLTFLoader();

    // Optional Draco geometry compression. The decoder is fetched from the local three package
    // copy if present; if the path is unavailable, uncompressed GLBs still load fine.
    try {
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath('./draco/');
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    } catch (err) {
      console.warn('[AssetLoader] Draco decoder unavailable; compressed geometry will not load.', err);
      this.dracoLoader = null;
    }

    // Optional KTX2 / Basis compressed textures. Requires the renderer for capability detection.
    if (renderer) {
      try {
        this.ktx2Loader = new KTX2Loader();
        this.ktx2Loader.setTranscoderPath('./basis/');
        this.ktx2Loader.detectSupport(renderer);
        this.gltfLoader.setKTX2Loader(this.ktx2Loader);
      } catch (err) {
        console.warn('[AssetLoader] KTX2 transcoder unavailable; compressed textures will not load.', err);
        this.ktx2Loader = null;
      }
    }

    // Optional Meshopt compression — decoder ships with three, so this is safe.
    try {
      this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    } catch (err) {
      console.warn('[AssetLoader] Meshopt decoder unavailable.', err);
    }
  }

  onProgress(cb: (p: AssetProgress) => void) {
    this.progressListeners.push(cb);
  }

  /** Declares how many load steps are expected, for progress reporting. */
  setTotalSteps(total: number) {
    this.totalCount = total;
    this.loadedCount = 0;
  }

  setLabel(label: string) {
    this.currentLabel = label;
    this.emitProgress();
  }

  private step(label?: string) {
    this.loadedCount = Math.min(this.totalCount, this.loadedCount + 1);
    if (label) this.currentLabel = label;
    this.emitProgress();
  }

  private emitProgress() {
    const p: AssetProgress = {
      label: this.currentLabel,
      loaded: this.loadedCount,
      total: Math.max(1, this.totalCount),
    };
    for (const cb of this.progressListeners) cb(p);
  }

  /**
   * Loads a model, falling back to procedural geometry on any failure.
   * Never rejects.
   */
  async loadModel(request: ModelRequest): Promise<LoadedModel> {
    const cacheKey = request.id;

    // Already known bad — go straight to the fallback without another network attempt.
    if (this.failed.has(cacheKey)) {
      this.step(request.id);
      return { object: request.fallback(), usedFallback: true, source: 'fallback(cached-failure)' };
    }

    const cachedSource = this.modelCache.get(cacheKey);
    if (cachedSource) {
      this.step(request.id);
      return {
        object: this.instantiate(cachedSource),
        usedFallback: false,
        source: `cache:${request.url}`,
      };
    }

    try {
      const gltf = await this.gltfLoader.loadAsync(request.url);
      const source = gltf.scene;

      if (request.targetLength !== undefined) {
        const result = normalizeModelSize(source, request.targetLength);
        if (result.suspectScale) {
          console.warn(
            `[AssetLoader] "${request.id}" needed an extreme scale factor (${result.scale.toFixed(4)}x) ` +
              `from source size ${result.originalSize.toArray().map((n) => n.toFixed(2)).join('x')} — ` +
              'check the exporter unit settings.',
          );
        }
      }
      if (request.transform) {
        applyModelTransform(source, request.transform);
      }

      source.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = false;
        }
      });

      this.modelCache.set(cacheKey, source);
      this.step(request.id);
      return { object: this.instantiate(source), usedFallback: false, source: request.url };
    } catch (err) {
      // Expected whenever an optional GLB has not been supplied — informational, not fatal.
      console.warn(
        `[AssetLoader] Could not load "${request.url}" for "${request.id}"; using procedural fallback geometry.`,
        err instanceof Error ? err.message : err,
      );
      this.failed.add(cacheKey);
      this.step(request.id);
      return { object: request.fallback(), usedFallback: true, source: 'fallback' };
    }
  }

  /**
   * Clones a cached source scene. Uses SkeletonUtils for rigged/animated models so skinned
   * meshes get their own bone hierarchy rather than sharing one.
   */
  private instantiate(source: THREE.Object3D): THREE.Object3D {
    let hasSkinnedMesh = false;
    source.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true;
    });
    return hasSkinnedMesh ? cloneSkinned(source) : source.clone(true);
  }

  async loadTexture(url: string, colorSpace = THREE.SRGBColorSpace): Promise<THREE.Texture | null> {
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    if (this.failed.has(url)) return null;
    try {
      const tex = await this.textureLoader.loadAsync(url);
      tex.colorSpace = colorSpace;
      this.textureCache.set(url, tex);
      return tex;
    } catch (err) {
      console.warn(`[AssetLoader] Texture "${url}" unavailable; continuing without it.`, err);
      this.failed.add(url);
      return null;
    }
  }

  /** Simulated step used for stages that build geometry procedurally rather than loading files. */
  completeStep(label: string) {
    this.step(label);
  }

  dispose() {
    for (const model of this.modelCache.values()) {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    }
    this.modelCache.clear();
    for (const tex of this.textureCache.values()) tex.dispose();
    this.textureCache.clear();
    this.dracoLoader?.dispose();
    this.ktx2Loader?.dispose();
    this.progressListeners = [];
  }
}
