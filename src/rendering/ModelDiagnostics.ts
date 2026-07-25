import * as THREE from 'three';

export interface ModelReport {
  name: string;
  meshCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  largestTextures: Array<{ name: string; width: number; height: number }>;
  animationClips: string[];
  boundingBox: { x: number; y: number; z: number };
  /** Problems worth fixing before shipping an asset. */
  warnings: string[];
}

/**
 * Development-only inspection of a loaded or procedural model.
 *
 * Reports geometry/material/texture counts and flags the issues that most often make an imported
 * asset look wrong in-game: missing normals (flat/black shading), missing UVs (textures ignored),
 * unlit materials, unintended transparency, and implausible scale.
 */
export function inspectModel(object: THREE.Object3D, name: string, clips: THREE.AnimationClip[] = []): ModelReport {
  let meshCount = 0;
  let triangleCount = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Map<string, THREE.Texture>();
  const warnings: string[] = [];

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshCount += 1;

    const geo = child.geometry;
    if (geo) {
      const index = geo.getIndex();
      const position = geo.getAttribute('position');
      if (index) triangleCount += index.count / 3;
      else if (position) triangleCount += position.count / 3;

      if (!geo.getAttribute('normal')) {
        warnings.push(`"${child.name || 'unnamed mesh'}" has no normals — shading will look flat or black.`);
      }
      if (!geo.getAttribute('uv')) {
        warnings.push(`"${child.name || 'unnamed mesh'}" has no UVs — any texture map will be ignored.`);
      }
    }

    const matList = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of matList) {
      if (!mat) continue;
      materials.add(mat);

      if (mat instanceof THREE.MeshBasicMaterial) {
        warnings.push(`Material "${mat.name || mat.type}" is unlit (MeshBasicMaterial) — it will ignore scene lighting.`);
      }
      if (mat.transparent) {
        warnings.push(`Material "${mat.name || mat.type}" is transparent — check it is intentional (it disables shadow casting).`);
      }

      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
        const tex = (mat as unknown as Record<string, THREE.Texture | null>)[key];
        if (tex && tex.image) {
          const id = tex.uuid;
          if (!textures.has(id)) textures.set(id, tex);
        }
      }
    }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);

  if (!Number.isFinite(size.length()) || size.length() === 0) {
    warnings.push('Bounding box is empty or invalid — the model may have failed to load.');
  } else {
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 2000) {
      warnings.push(`Bounding box is ${maxDim.toFixed(0)} m across — suspiciously large, likely a unit mismatch (cm vs m).`);
    } else if (maxDim < 0.1) {
      warnings.push(`Bounding box is only ${maxDim.toFixed(3)} m across — suspiciously small, likely a unit mismatch.`);
    }
  }

  const largestTextures = [...textures.values()]
    .map((t) => {
      const img = t.image as { width?: number; height?: number } | undefined;
      return { name: t.name || t.uuid.slice(0, 8), width: img?.width ?? 0, height: img?.height ?? 0 };
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 5);

  for (const tex of largestTextures) {
    if (tex.width > 2048 || tex.height > 2048) {
      warnings.push(`Texture "${tex.name}" is ${tex.width}x${tex.height} — consider downscaling to 2048 or smaller.`);
    }
  }

  return {
    name,
    meshCount,
    triangleCount: Math.round(triangleCount),
    materialCount: materials.size,
    textureCount: textures.size,
    largestTextures,
    animationClips: clips.map((c) => c.name),
    boundingBox: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
    warnings: [...new Set(warnings)],
  };
}

/** Logs an inspection report as a collapsed console group. Development builds only. */
export function logModelReport(report: ModelReport) {
  /* eslint-disable no-console */
  console.groupCollapsed(
    `[ModelDiagnostics] ${report.name} — ${report.meshCount} meshes, ${report.triangleCount.toLocaleString()} tris`,
  );
  console.log('Bounding box (m):', report.boundingBox);
  console.log('Materials:', report.materialCount, ' Textures:', report.textureCount);
  if (report.largestTextures.length > 0) console.table(report.largestTextures);
  if (report.animationClips.length > 0) console.log('Animation clips:', report.animationClips);
  if (report.warnings.length > 0) {
    for (const w of report.warnings) console.warn(' •', w);
  } else {
    console.log('No issues detected.');
  }
  console.groupEnd();
  /* eslint-enable no-console */
}
