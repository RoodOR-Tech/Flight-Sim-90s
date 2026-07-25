import * as THREE from 'three';
import { getConcreteTexture, getRockTexture, getSoftParticleTexture } from '../rendering/ProceduralTextures';

// Small decorative props and shared particle sprites.
//
// The detailed aircraft, carrier, radar-site and missile models now live under
// `src/rendering/models/`. What remains here is the simple scenery that is genuinely better off as
// primitives (huts, sheds, masts, boats) plus a few shared helpers.
//
// Everything is procedural: no external models, images or textures are loaded.

function flat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
}

export const Materials = {
  building: flat(0x8c8375),
  roof: flat(0x7c4b3e),
  rock: flat(0x6b6455),
  hill: flat(0x556b45),
  beach: flat(0xcdb98a),
  tower: flat(0x9aa0a3, { roughness: 0.6, metalness: 0.4 }),
  boatHull: flat(0x4a5a4a),
  boatCabin: flat(0xb9b4a6),
  deckLight: new THREE.MeshBasicMaterial({ color: 0xffee88 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x1b2a30,
    roughness: 0.2,
    metalness: 0.6,
  }),
};

/** Shared soft particle sprite (re-exported for the effects system). */
export function getSoftDotTexture(): THREE.Texture {
  return getSoftParticleTexture();
}

/**
 * Small coastal structures. Deliberately simple — these are background scenery seen from altitude,
 * and keeping them cheap leaves the frame budget for the aircraft, carrier and terrain.
 */
export function buildDecorativeBuilding(kind: 'hut' | 'tower' | 'warehouse'): THREE.Group {
  const g = new THREE.Group();

  if (kind === 'tower') {
    // Lattice radio mast with guy wires and a beacon.
    const towerGeo = new THREE.CylinderGeometry(0.28, 0.45, 24, 6);
    const tower = new THREE.Mesh(towerGeo, Materials.tower);
    tower.position.y = 12;
    g.add(tower);

    const barGeo = new THREE.BoxGeometry(2.6, 0.13, 0.13);
    for (let y = 3; y < 23; y += 3.4) {
      const bar = new THREE.Mesh(barGeo, Materials.tower);
      bar.position.y = y;
      g.add(bar);
      const bar2 = bar.clone();
      bar2.rotation.y = Math.PI / 2;
      g.add(bar2);
      // Diagonal bracing gives the mast visible depth.
      const brace = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.08), Materials.tower);
      brace.position.y = y + 1.7;
      brace.rotation.z = 0.5;
      g.add(brace);
    }

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), Materials.deckLight);
    beacon.position.y = 24.4;
    g.add(beacon);
  } else if (kind === 'warehouse') {
    const concreteMap = getConcreteTexture().clone();
    concreteMap.needsUpdate = true;
    concreteMap.wrapS = THREE.RepeatWrapping;
    concreteMap.wrapT = THREE.RepeatWrapping;
    concreteMap.repeat.set(3, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.92, metalness: 0.03 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(11, 5.5, 17), wallMat);
    box.position.y = 2.75;
    g.add(box);

    // Pitched roof from a rotated box pair, rather than a flat slab.
    const roofGeo = new THREE.BoxGeometry(6.4, 0.4, 17.4);
    for (const side of [1, -1]) {
      const slope = new THREE.Mesh(roofGeo, Materials.roof);
      slope.position.set(side * 2.85, 6.4, 0);
      slope.rotation.z = side * -0.32;
      g.add(slope);
    }

    // Roller doors on the gable ends.
    for (const z of [8.55, -8.55]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4, 0.2), Materials.roof);
      door.position.set(0, 2, z);
      g.add(door);
    }
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.2, 5), Materials.building);
    box.position.y = 1.6;
    g.add(box);

    const roofGeo = new THREE.ConeGeometry(3.9, 2.2, 4);
    const roof = new THREE.Mesh(roofGeo, Materials.roof);
    roof.position.y = 4.3;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);

    // Windows so the hut is not a bare block up close.
    for (const [x, z, ry] of [
      [0, 2.55, 0],
      [2.35, 0, Math.PI / 2],
    ] as Array<[number, number, number]>) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), Materials.glass);
      win.position.set(x, 1.9, z);
      win.rotation.y = ry;
      g.add(win);
    }
  }

  return g;
}

/** Small civilian/patrol craft with a shaped hull. */
export function buildPatrolBoat(): THREE.Group {
  const g = new THREE.Group();

  // Hull from a tapered extrusion so the bow comes to a point.
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1.5, 0);
  hullShape.lineTo(1.5, 0);
  hullShape.lineTo(1.2, 1.9);
  hullShape.lineTo(-1.2, 1.9);
  hullShape.closePath();
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hullShape, { depth: 11, bevelEnabled: false }),
    Materials.boatHull,
  );
  hull.rotation.x = -Math.PI / 2;
  hull.position.set(0, 0, 5.5);
  g.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 4), Materials.boatHull);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 0.6);
  bow.position.set(0, 0.95, -6.6);
  g.add(bow);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 3.4), Materials.boatCabin);
  cabin.position.set(0, 2.7, -1);
  g.add(cabin);

  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.8), Materials.glass);
  windshield.position.set(0, 3.05, -2.75);
  g.add(windshield);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 5), Materials.tower);
  mast.position.set(0, 5.1, -0.5);
  g.add(mast);

  return g;
}

/** Simple rocky outcrop, used for tiny islets that do not warrant a full terrain mesh. */
export function buildRockyIsland(radius: number, height: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const rockMap = getRockTexture().clone();
  rockMap.needsUpdate = true;
  rockMap.wrapS = THREE.RepeatWrapping;
  rockMap.wrapT = THREE.RepeatWrapping;
  rockMap.repeat.set(3, 3);
  const rockMat = new THREE.MeshStandardMaterial({ map: rockMap, roughness: 0.95, metalness: 0.02 });

  const coneGeo = new THREE.ConeGeometry(radius, height, 7 + Math.floor(rand() * 3));
  // Jitter the vertices so the outcrop is irregular rather than a clean cone.
  const pos = coneGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (rand() - 0.5) * radius * 0.22);
    pos.setZ(i, pos.getZ(i) + (rand() - 0.5) * radius * 0.22);
  }
  pos.needsUpdate = true;
  coneGeo.computeVertexNormals();

  const cone = new THREE.Mesh(coneGeo, rockMat);
  cone.position.y = height / 2 - 0.6;
  cone.rotation.y = rand() * Math.PI;
  g.add(cone);

  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.24, radius * 1.36, 1.1, 10),
    Materials.beach,
  );
  beach.position.y = -0.4;
  g.add(beach);

  return g;
}

export function mulberry32(seedIn: number) {
  let a = seedIn >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
