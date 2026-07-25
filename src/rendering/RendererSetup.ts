import * as THREE from 'three';
import { GraphicsSettings } from './GraphicsPresets';
import {
  CAMERA_BASE_FOV,
  CAMERA_FAR,
  CAMERA_NEAR,
  MAX_PIXEL_RATIO,
  TONE_MAPPING_EXPOSURE,
} from './RenderConstants';

// Pattern reference: OpenSkyFlight `js/scene/SceneSetup.js` (MIT) — keep renderer, scene and
// camera construction in small factories instead of inlining them in the game class.

export function createRenderer(canvas: HTMLCanvasElement, settings: GraphicsSettings): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !settings.postProcessing, // an SMAA pass replaces MSAA when postprocessing is on
    powerPreference: 'high-performance',
    stencil: false,
  });

  // Correct colour pipeline: linear working space, sRGB output, filmic tone mapping.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

  applyRendererQuality(renderer, settings);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}

/** Re-applies the quality-dependent renderer state. Safe to call when the preset changes. */
export function applyRendererQuality(renderer: THREE.WebGLRenderer, settings: GraphicsSettings) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, settings.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = settings.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = settings.shadowsEnabled;
}

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(
    CAMERA_BASE_FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  return scene;
}

/** Max anisotropy the hardware supports, clamped by the active preset. */
export function resolveAnisotropy(renderer: THREE.WebGLRenderer, settings: GraphicsSettings): number {
  const hardwareMax = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  return Math.max(1, Math.min(hardwareMax, settings.anisotropy));
}
