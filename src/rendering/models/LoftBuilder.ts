import * as THREE from 'three';

export interface LoftSection {
  /** Station position along the loft axis (local Z). */
  z: number;
  /** Cross-section outline points in the X/Y plane. Every section must have the same length. */
  points: THREE.Vector2[];
}

/**
 * Generates a smooth "superellipse" cross-section ring.
 *
 * `squareness` shapes the outline between a pure ellipse (0) and a rounded rectangle (1), which is
 * how real fuselages transition from a round nose to a chined, boxier mid-body. `flatBottom`
 * lowers the underside curvature so the belly reads flat like an aircraft rather than a tube.
 */
export function ellipseRing(
  halfWidth: number,
  halfHeight: number,
  segments: number,
  squareness = 0,
  flatBottom = 0,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const exponent = 2 / (1 + squareness * 1.6); // 2 = ellipse, →1 = boxier
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // Superellipse via signed power
    const sx = Math.sign(c) * Math.pow(Math.abs(c), exponent);
    const sy = Math.sign(s) * Math.pow(Math.abs(s), exponent);
    let y = sy * halfHeight;
    if (s < 0 && flatBottom > 0) {
      // Compress the lower half toward a flat belly.
      y *= 1 - flatBottom * 0.55;
      y -= flatBottom * halfHeight * 0.12;
    }
    points.push(new THREE.Vector2(sx * halfWidth, y));
  }
  return points;
}

/**
 * Lofts a series of cross-sections into a closed, smooth-shaded surface.
 *
 * Consecutive rings are stitched with quads (two triangles each); the ends are capped with a
 * triangle fan to a centre vertex. Normals are computed from the resulting geometry, so the
 * surface shades smoothly instead of showing the facets of a primitive.
 */
export function loftSections(sections: LoftSection[], capStart = true, capEnd = true): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error('loftSections requires at least two sections');
  const ringSize = sections[0].points.length;
  for (const s of sections) {
    if (s.points.length !== ringSize) {
      throw new Error('All loft sections must have the same number of points');
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Ring vertices
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const v = si / (sections.length - 1);
    for (let pi = 0; pi < ringSize; pi++) {
      const p = section.points[pi];
      positions.push(p.x, p.y, section.z);
      uvs.push(pi / ringSize, v);
    }
  }

  // Stitch adjacent rings
  for (let si = 0; si < sections.length - 1; si++) {
    const rowA = si * ringSize;
    const rowB = (si + 1) * ringSize;
    for (let pi = 0; pi < ringSize; pi++) {
      const next = (pi + 1) % ringSize;
      const a = rowA + pi;
      const b = rowA + next;
      const c = rowB + pi;
      const d = rowB + next;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // End caps as triangle fans to a centre point
  if (capStart) {
    const centerIndex = positions.length / 3;
    const s = sections[0];
    let cx = 0;
    let cy = 0;
    for (const p of s.points) {
      cx += p.x;
      cy += p.y;
    }
    positions.push(cx / ringSize, cy / ringSize, s.z);
    uvs.push(0.5, 0);
    for (let pi = 0; pi < ringSize; pi++) {
      const next = (pi + 1) % ringSize;
      indices.push(centerIndex, pi, next);
    }
  }
  if (capEnd) {
    const centerIndex = positions.length / 3;
    const lastRow = (sections.length - 1) * ringSize;
    const s = sections[sections.length - 1];
    let cx = 0;
    let cy = 0;
    for (const p of s.points) {
      cx += p.x;
      cy += p.y;
    }
    positions.push(cx / ringSize, cy / ringSize, s.z);
    uvs.push(0.5, 1);
    for (let pi = 0; pi < ringSize; pi++) {
      const next = (pi + 1) % ringSize;
      indices.push(centerIndex, lastRow + next, lastRow + pi);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds a tapered lifting surface (wing / stabiliser / fin) with a real airfoil section,
 * sweep, taper and optional dihedral or cant.
 */
export interface WingParams {
  rootChord: number;
  tipChord: number;
  span: number;
  /** Leading-edge sweep in radians. */
  sweep: number;
  /** Thickness-to-chord ratio. */
  thickness: number;
  /** Upward tilt in radians. */
  dihedral?: number;
  /** Number of spanwise stations (more = smoother taper). */
  stations?: number;
  /** Fraction of span over which the root blends into a thicker fairing. */
  rootBlend?: number;
}

/**
 * NACA-style symmetric airfoil half-thickness at chord fraction `t` (0..1).
 * Produces a rounded leading edge and a sharp trailing edge, which is what makes a wing read as
 * a wing rather than a flat plate.
 */
function airfoilThickness(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return (
    0.2969 * Math.sqrt(x) -
    0.126 * x -
    0.3516 * x * x +
    0.2843 * x * x * x -
    0.1015 * x * x * x * x
  );
}

/**
 * Emits a lifting surface with span along **+X**, chord along **+Z** (leading edge toward -Z) and
 * thickness along **+Y** — i.e. a right-hand wing in the aircraft's own coordinate frame, matching
 * the game's forward = -Z convention. Mirror with `mirrorX` for the left-hand side, or rotate
 * about Z by ±90° to make a vertical fin.
 */
export function buildWing(params: WingParams): THREE.BufferGeometry {
  const {
    rootChord,
    tipChord,
    span,
    sweep,
    thickness,
    dihedral = 0,
    stations = 7,
    rootBlend = 0.22,
  } = params;

  const chordSamples = 13;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringSize = chordSamples * 2 - 2;

  for (let si = 0; si < stations; si++) {
    const spanT = si / (stations - 1);
    const spanPos = spanT * span;
    const chord = THREE.MathUtils.lerp(rootChord, tipChord, spanT);
    const leadingEdge = Math.tan(sweep) * spanPos;
    const height = dihedral * spanPos;

    // Thicken the innermost stations so the wing blends into the fuselage instead of butting it.
    const blendFactor = spanT < rootBlend ? 1 + (1 - spanT / rootBlend) * 0.85 : 1;
    const tRatio = thickness * blendFactor;

    // Upper surface front→back, then lower surface back→front (closed outline).
    for (let ci = 0; ci < chordSamples; ci++) {
      const t = ci / (chordSamples - 1);
      const chordPos = leadingEdge + t * chord;
      const th = airfoilThickness(t) * chord * tRatio;
      positions.push(spanPos, height + th, chordPos);
      uvs.push(t, spanT);
    }
    for (let ci = chordSamples - 2; ci >= 1; ci--) {
      const t = ci / (chordSamples - 1);
      const chordPos = leadingEdge + t * chord;
      const th = airfoilThickness(t) * chord * tRatio;
      positions.push(spanPos, height - th, chordPos);
      uvs.push(t, spanT);
    }
  }

  // Winding is ordered so face normals point outward given the (span=X, thickness=Y, chord=Z)
  // vertex layout above.
  for (let si = 0; si < stations - 1; si++) {
    const rowA = si * ringSize;
    const rowB = (si + 1) * ringSize;
    for (let pi = 0; pi < ringSize; pi++) {
      const next = (pi + 1) % ringSize;
      indices.push(rowA + pi, rowA + next, rowB + pi);
      indices.push(rowA + next, rowB + next, rowB + pi);
    }
  }

  // Cap the wingtip (outboard end)
  const tipRow = (stations - 1) * ringSize;
  for (let pi = 1; pi < ringSize - 1; pi++) {
    indices.push(tipRow, tipRow + pi + 1, tipRow + pi);
  }
  // Cap the root (inboard end, usually hidden inside the fuselage)
  for (let pi = 1; pi < ringSize - 1; pi++) {
    indices.push(0, pi, pi + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Convenience: mirror a geometry across X to make a left/right pair. */
export function mirrorX(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const mirrored = geometry.clone();
  mirrored.scale(-1, 1, 1);
  // Flip winding so normals face outward again after the negative scale.
  const index = mirrored.getIndex();
  if (index) {
    const arr = index.array as unknown as number[];
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i];
      arr[i] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  mirrored.computeVertexNormals();
  return mirrored;
}
