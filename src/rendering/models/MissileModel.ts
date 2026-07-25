import * as THREE from 'three';
import { ellipseRing, loftSections, LoftSection } from './LoftBuilder';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0xd6d9db,
  roughness: 0.42,
  metalness: 0.55,
});
const seekerMaterial = new THREE.MeshStandardMaterial({
  color: 0x2b2f33,
  roughness: 0.22,
  metalness: 0.7,
});
const bandMaterial = new THREE.MeshStandardMaterial({
  color: 0x9a3026,
  roughness: 0.6,
  metalness: 0.2,
});
const finMaterial = new THREE.MeshStandardMaterial({
  color: 0xb8bcbf,
  roughness: 0.5,
  metalness: 0.5,
});

// Geometry is built once at module scope and shared by every missile instance.
let sharedGeometry: {
  body: THREE.BufferGeometry;
  seeker: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  fin: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
} | null = null;

function getSharedGeometry() {
  if (sharedGeometry) return sharedGeometry;

  // Lofted body: ogive nose fairing into a constant-diameter tube.
  const sections: LoftSection[] = [
    { z: -1.02, points: ellipseRing(0.012, 0.012, 10, 0, 0) },
    { z: -0.94, points: ellipseRing(0.038, 0.038, 10, 0, 0) },
    { z: -0.82, points: ellipseRing(0.062, 0.062, 10, 0, 0) },
    { z: -0.66, points: ellipseRing(0.078, 0.078, 10, 0, 0) },
    { z: -0.4, points: ellipseRing(0.086, 0.086, 10, 0, 0) },
    { z: 0.55, points: ellipseRing(0.086, 0.086, 10, 0, 0) },
    { z: 0.86, points: ellipseRing(0.08, 0.08, 10, 0, 0) },
  ];
  const body = loftSections(sections, true, true);

  const seeker = new THREE.SphereGeometry(0.04, 10, 8);
  seeker.translate(0, 0, -1.02);

  const band = new THREE.CylinderGeometry(0.089, 0.089, 0.07, 10);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0, -0.28);

  // Tail control fin
  const fin = new THREE.BoxGeometry(0.22, 0.014, 0.2);
  fin.translate(0.14, 0, 0.7);

  // Mid-body guidance wing (longer chord, thinner)
  const wing = new THREE.BoxGeometry(0.3, 0.012, 0.14);
  wing.translate(0.18, 0, 0.05);

  sharedGeometry = { body, seeker, band, fin, wing };
  return sharedGeometry;
}

/**
 * A radar-guided air-to-air missile.
 *
 * `scale` lets the same model serve as both a captive round on a pylon and an in-flight missile.
 * Geometry and materials are shared across instances, so spawning rounds is cheap.
 */
export function buildMissileVisual(scale = 1): THREE.Group {
  const g = getSharedGeometry();
  const group = new THREE.Group();
  group.name = 'missile';

  group.add(new THREE.Mesh(g.body, bodyMaterial));
  group.add(new THREE.Mesh(g.seeker, seekerMaterial));
  group.add(new THREE.Mesh(g.band, bandMaterial));

  // Four tail fins and four mid-body wings in a cruciform arrangement.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(g.fin, finMaterial);
    fin.rotation.z = angle;
    group.add(fin);
    const wing = new THREE.Mesh(g.wing, finMaterial);
    wing.rotation.z = angle + Math.PI / 4;
    group.add(wing);
  }

  group.scale.setScalar(scale);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.frustumCulled = true;
    }
  });
  return group;
}

/** Bright additive exhaust flare that trails the motor while it burns. */
export function buildMissileFlare(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.13, 1.1, 10, 1, true);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 1.35);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffc46a,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  return mesh;
}
