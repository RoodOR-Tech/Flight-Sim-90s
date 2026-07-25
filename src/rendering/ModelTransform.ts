import * as THREE from 'three';

/**
 * Orientation/scale correction applied to an externally authored model.
 *
 * Kept as explicit data rather than buried in entity logic: a GLB exported from any DCC tool will
 * almost certainly disagree with this game's convention (forward = -Z, up = +Y, metres), and the
 * fix belongs in one declared place per asset.
 */
export interface ModelTransformConfig {
  /** Uniform scale multiplier applied after any auto-fit. */
  scale: number;
  /** Euler rotation in **degrees**, applied in XYZ order. */
  rotation: { x: number; y: number; z: number };
  /** Translation applied after rotation and scaling, in metres. */
  offset: { x: number; y: number; z: number };
}

export const IDENTITY_TRANSFORM: ModelTransformConfig = {
  scale: 1,
  rotation: { x: 0, y: 0, z: 0 },
  offset: { x: 0, y: 0, z: 0 },
};

export function makeTransform(partial: Partial<ModelTransformConfig>): ModelTransformConfig {
  return {
    scale: partial.scale ?? 1,
    rotation: { ...IDENTITY_TRANSFORM.rotation, ...partial.rotation },
    offset: { ...IDENTITY_TRANSFORM.offset, ...partial.offset },
  };
}

/** Applies a transform config to an object's local transform. */
export function applyModelTransform(object: THREE.Object3D, config: ModelTransformConfig) {
  object.scale.multiplyScalar(config.scale);
  object.rotation.set(
    THREE.MathUtils.degToRad(config.rotation.x),
    THREE.MathUtils.degToRad(config.rotation.y),
    THREE.MathUtils.degToRad(config.rotation.z),
  );
  object.position.set(config.offset.x, config.offset.y, config.offset.z);
}

export interface NormalizeResult {
  /** Scale factor chosen to reach the requested length. */
  scale: number;
  /** Bounding-box size before scaling. */
  originalSize: THREE.Vector3;
  /** True when the source model's size looked implausible (likely a unit mismatch). */
  suspectScale: boolean;
}

/**
 * Fits a loaded model to a target length along its longest axis and recentres it on its
 * bounding-box centre.
 *
 * Pattern reference: OpenSkyFlight `js/aircraft/AircraftManager.js` (MIT) normalizes the Rafale
 * GLB this way — measure the bounding box, scale the longest dimension to a known target, then
 * subtract the scaled centre so the model pivots about itself. Extended here with a plausibility
 * check that flags likely centimetre/inch unit mismatches.
 */
export function normalizeModelSize(
  model: THREE.Object3D,
  targetLength: number,
  recenter = true,
): NormalizeResult {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  if (!Number.isFinite(maxDim) || maxDim <= 1e-6) {
    return { scale: 1, originalSize: size, suspectScale: true };
  }

  const scale = targetLength / maxDim;
  model.scale.multiplyScalar(scale);

  if (recenter) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    center.multiplyScalar(scale);
    model.position.sub(center);
  }

  // A source model more than ~50x off the target usually means the exporter used different units.
  const suspectScale = scale > 50 || scale < 0.02;
  return { scale, originalSize: size, suspectScale };
}
