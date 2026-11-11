import * as THREE from 'three';
import { GraphicsSettings } from '../GraphicsPresets';

export type GroundUnitKind = 'tank' | 'flak';

export interface GroundUnitModelResult {
  group: THREE.Group;
  /** Rotates about Y to track a target. */
  turret: THREE.Object3D;
  /** Pitches about X (flak barrels elevate toward aircraft). */
  barrel: THREE.Object3D;
  /** Everything that is hidden when the vehicle is destroyed. */
  intact: THREE.Object3D;
  /** Burnt-out hull revealed on destruction. */
  wreckage: THREE.Object3D;
  /** Where the smoke column rises from once destroyed. */
  smokePoint: THREE.Object3D;
}

// Geometry and materials are shared across every vehicle: there are eight of them on screen and
// they are identical within a kind, so nothing here is per-instance or needs disposal.
const hullMat = new THREE.MeshStandardMaterial({ color: 0x5b6046, roughness: 0.85, metalness: 0.25 });
const flakMat = new THREE.MeshStandardMaterial({ color: 0x66604a, roughness: 0.85, metalness: 0.25 });
const trackMat = new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.95, metalness: 0.1 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2f322b, roughness: 0.6, metalness: 0.55 });
const wreckMat = new THREE.MeshStandardMaterial({ color: 0x1a1915, roughness: 1, metalness: 0.1 });

const geo = {
  hull: new THREE.BoxGeometry(3.4, 1.0, 6.6),
  glacis: new THREE.BoxGeometry(3.2, 0.5, 1.6),
  track: new THREE.BoxGeometry(0.7, 0.9, 7.0),
  tankTurret: new THREE.CylinderGeometry(1.35, 1.6, 0.85, 10),
  tankBarrel: new THREE.CylinderGeometry(0.11, 0.13, 4.6, 8),
  flakTurret: new THREE.BoxGeometry(2.2, 1.0, 2.4),
  flakBarrel: new THREE.CylinderGeometry(0.06, 0.07, 2.8, 6),
  flakDish: new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10),
  wreckHull: new THREE.BoxGeometry(3.4, 0.8, 6.4),
  wreckTurret: new THREE.CylinderGeometry(1.3, 1.5, 0.7, 8),
};
// Barrels are modelled along -Z (forward) with their breech at the origin, so they pivot there.
geo.tankBarrel.rotateX(Math.PI / 2);
geo.tankBarrel.translate(0, 0, -2.3);
geo.flakBarrel.rotateX(Math.PI / 2);
geo.flakBarrel.translate(0, 0, -1.4);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows: boolean): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.castShadow = shadows;
  out.receiveShadow = shadows;
  return out;
}

/**
 * A tracked armoured vehicle: main battle tank or twin-barrel flak carrier on the same chassis.
 * Deliberately low-poly — these are seen from attack altitude — but with a readable silhouette:
 * hull, track runs, turret and gun. Forward is -Z, origin is on the ground under the hull centre.
 */
export function buildGroundUnitModel(kind: GroundUnitKind, settings: GraphicsSettings): GroundUnitModelResult {
  const shadows = settings.shadowsEnabled;
  const group = new THREE.Group();
  group.name = `ground-unit-${kind}`;
  const intact = new THREE.Group();
  group.add(intact);
  const bodyMat = kind === 'tank' ? hullMat : flakMat;

  const hull = mesh(geo.hull, bodyMat, shadows);
  hull.position.y = 1.15;
  intact.add(hull);
  const glacis = mesh(geo.glacis, bodyMat, shadows);
  glacis.position.set(0, 0.95, -3.5);
  glacis.rotation.x = -0.5;
  intact.add(glacis);
  for (const side of [-1, 1]) {
    const track = mesh(geo.track, trackMat, shadows);
    track.position.set(side * 1.75, 0.45, 0);
    intact.add(track);
  }

  const turret = new THREE.Group();
  turret.position.y = 1.65;
  intact.add(turret);
  const barrel = new THREE.Group();
  turret.add(barrel);

  if (kind === 'tank') {
    const body = mesh(geo.tankTurret, bodyMat, shadows);
    body.position.y = 0.42;
    turret.add(body);
    barrel.position.set(0, 0.45, -1.2);
    barrel.add(mesh(geo.tankBarrel, gunMat, shadows));
  } else {
    const body = mesh(geo.flakTurret, bodyMat, shadows);
    body.position.y = 0.5;
    turret.add(body);
    barrel.position.set(0, 0.75, -0.9);
    for (const side of [-1, 1]) {
      const b = mesh(geo.flakBarrel, gunMat, shadows);
      b.position.x = side * 0.45;
      barrel.add(b);
    }
    const dish = mesh(geo.flakDish, gunMat, shadows);
    dish.position.set(0, 1.35, 0.7);
    dish.rotation.x = Math.PI / 2 - 0.4;
    turret.add(dish);
  }

  const wreckage = new THREE.Group();
  const wHull = mesh(geo.wreckHull, wreckMat, shadows);
  wHull.position.y = 0.75;
  wHull.rotation.z = 0.06;
  wreckage.add(wHull);
  const wTurret = mesh(geo.wreckTurret, wreckMat, shadows);
  // Blown off its ring and lying askew beside the hull.
  wTurret.position.set(2.6, 0.5, 0.8);
  wTurret.rotation.set(0.5, 0.4, 0.9);
  wreckage.add(wTurret);
  wreckage.visible = false;
  group.add(wreckage);

  const smokePoint = new THREE.Object3D();
  smokePoint.position.y = 1.6;
  group.add(smokePoint);

  return { group, turret, barrel, intact, wreckage, smokePoint };
}
