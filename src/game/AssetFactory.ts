import * as THREE from 'three';

// All visuals in this game are procedurally constructed from Three.js primitives.
// No external models, images, or textures are loaded from disk or network - the only
// "textures" used are small canvases generated at runtime for soft particle sprites.

function flat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
}

export const Materials = {
  playerJet: flat(0x5c6b73),
  playerJetDark: flat(0x33404a),
  canopy: new THREE.MeshStandardMaterial({ color: 0x113322, flatShading: true, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.85 }),
  enemyJet: flat(0x7a2a2a),
  enemyJetDark: flat(0x4a1818),
  navLightRed: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  navLightGreen: new THREE.MeshBasicMaterial({ color: 0x30ff50 }),
  gear: flat(0x1a1a1a),
  missileBody: flat(0xcfd2d4),
  missileTip: flat(0xaa2222),
  carrierHull: flat(0x3d4348),
  carrierDeck: flat(0x54595c),
  carrierIsland: flat(0x484e52),
  carrierStripe: flat(0xe8c93a),
  radarDish: flat(0x8a8f78),
  radarBase: flat(0x555a4a),
  building: flat(0x716a5c),
  roof: flat(0x8a3b3b),
  rock: flat(0x6b6455),
  hill: flat(0x556b45),
  beach: flat(0xcdb98a),
  tower: flat(0x999999),
  boatHull: flat(0x445544),
  deckLight: new THREE.MeshBasicMaterial({ color: 0xffee88 }),
};

let softDotTextureCache: THREE.Texture | null = null;
/** A soft radial-gradient sprite, generated on a canvas, used for smoke/explosion/wake particles. */
export function getSoftDotTexture(): THREE.Texture {
  if (softDotTextureCache) return softDotTextureCache;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  softDotTextureCache = tex;
  return tex;
}

export interface AircraftVisual {
  group: THREE.Group;
  gearGroup: THREE.Object3D;
  leftFlap: THREE.Object3D;
  rightFlap: THREE.Object3D;
  leftEngineGlow: THREE.Mesh;
  rightEngineGlow: THREE.Mesh;
  cannonMuzzle: THREE.Object3D;
  wingtipL: THREE.Object3D;
  wingtipR: THREE.Object3D;
}

/**
 * Builds a low-poly twin-engine naval interceptor from primitives: tapered fuselage, swept
 * wings, twin canted vertical stabilizers, twin engine nacelles, canopy, gear, and nav lights.
 */
export function buildAircraft(hostile: boolean): AircraftVisual {
  const bodyMat = hostile ? Materials.enemyJet : Materials.playerJet;
  const darkMat = hostile ? Materials.enemyJetDark : Materials.playerJetDark;
  const group = new THREE.Group();
  group.name = hostile ? 'Kestrel-9' : 'PlayerAircraft';

  // Fuselage: tapered cylinder, nose pointing -Z
  const fuselageGeo = new THREE.CylinderGeometry(0.35, 0.62, 5.4, 8, 1);
  const fuselage = new THREE.Mesh(fuselageGeo, bodyMat);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = 0.2;
  group.add(fuselage);

  const noseGeo = new THREE.ConeGeometry(0.35, 1.3, 8);
  const nose = new THREE.Mesh(noseGeo, darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.9;
  group.add(nose);

  // Canopy
  const canopyGeo = new THREE.SphereGeometry(0.42, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.7);
  const canopy = new THREE.Mesh(canopyGeo, Materials.canopy);
  canopy.scale.set(0.85, 0.75, 1.6);
  canopy.position.set(0, 0.42, -0.4);
  group.add(canopy);

  // Wings (swept trapezoid via extruded shape)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(3.4, -1.1);
  wingShape.lineTo(3.0, -1.7);
  wingShape.lineTo(0.6, -1.0);
  wingShape.lineTo(-0.3, 0.4);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: false });
  const wingR = new THREE.Mesh(wingGeo, bodyMat);
  wingR.rotation.x = Math.PI / 2;
  wingR.position.set(0.4, -0.05, 0.9);
  group.add(wingR);
  const wingL = wingR.clone();
  wingL.scale.x = -1;
  group.add(wingL);

  const wingtipR = new THREE.Object3D();
  wingtipR.position.set(3.6, -0.05, -0.1);
  group.add(wingtipR);
  const wingtipL = new THREE.Object3D();
  wingtipL.position.set(-3.6, -0.05, -0.1);
  group.add(wingtipL);

  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), Materials.navLightGreen);
  navR.position.copy(wingtipR.position);
  group.add(navR);
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), Materials.navLightRed);
  navL.position.copy(wingtipL.position);
  group.add(navL);

  // Tail stabilizers (twin canted verticals)
  const finGeo = new THREE.BoxGeometry(0.1, 1.1, 1.3);
  const finR = new THREE.Mesh(finGeo, darkMat);
  finR.position.set(0.55, 0.55, 2.1);
  finR.rotation.z = -0.35;
  group.add(finR);
  const finL = new THREE.Mesh(finGeo, darkMat);
  finL.position.set(-0.55, 0.55, 2.1);
  finL.rotation.z = 0.35;
  group.add(finL);

  const stabGeo = new THREE.BoxGeometry(2.2, 0.08, 0.9);
  const stab = new THREE.Mesh(stabGeo, bodyMat);
  stab.position.set(0, 0.1, 2.3);
  group.add(stab);

  // Twin engine nacelles
  const engineGeo = new THREE.CylinderGeometry(0.34, 0.3, 1.6, 8);
  const engineR = new THREE.Mesh(engineGeo, darkMat);
  engineR.rotation.x = -Math.PI / 2;
  engineR.position.set(0.55, -0.15, 2.0);
  group.add(engineR);
  const engineL = engineR.clone();
  engineL.position.x = -0.55;
  group.add(engineL);

  const glowGeo = new THREE.CircleGeometry(0.3, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8822, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const leftEngineGlow = new THREE.Mesh(glowGeo, glowMat);
  leftEngineGlow.position.set(-0.55, -0.15, 2.85);
  group.add(leftEngineGlow);
  const rightEngineGlow = new THREE.Mesh(glowGeo, glowMat.clone());
  rightEngineGlow.position.set(0.55, -0.15, 2.85);
  group.add(rightEngineGlow);

  // Landing gear indicators (simplified struts + wheels)
  const gearGroup = new THREE.Group();
  const strutGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6);
  const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.15, 8);
  function makeGear(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const strut = new THREE.Mesh(strutGeo, Materials.gear);
    strut.position.y = -0.35;
    g.add(strut);
    const wheel = new THREE.Mesh(wheelGeo, Materials.gear);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.y = -0.7;
    g.add(wheel);
    g.position.set(x, -0.35, z);
    return g;
  }
  gearGroup.add(makeGear(0, 1.0));
  gearGroup.add(makeGear(0.9, -1.6));
  gearGroup.add(makeGear(-0.9, -1.6));
  group.add(gearGroup);

  // Flaps (small hinge boxes on trailing edge of wings)
  const flapGeo = new THREE.BoxGeometry(1.1, 0.08, 0.4);
  const rightFlap = new THREE.Mesh(flapGeo, darkMat);
  rightFlap.position.set(1.4, -0.05, 1.75);
  group.add(rightFlap);
  const leftFlap = new THREE.Mesh(flapGeo, darkMat);
  leftFlap.position.set(-1.4, -0.05, 1.75);
  group.add(leftFlap);

  const cannonMuzzle = new THREE.Object3D();
  cannonMuzzle.position.set(0, -0.1, -3.4);
  group.add(cannonMuzzle);

  group.castShadow = false;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });

  return { group, gearGroup, leftFlap, rightFlap, leftEngineGlow, rightEngineGlow, cannonMuzzle, wingtipL, wingtipR };
}

export function buildMissileVisual(): THREE.Group {
  const g = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8);
  const body = new THREE.Mesh(bodyGeo, Materials.missileBody);
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  const tipGeo = new THREE.ConeGeometry(0.09, 0.35, 8);
  const tip = new THREE.Mesh(tipGeo, Materials.missileTip);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.95;
  g.add(tip);
  const finGeo = new THREE.BoxGeometry(0.45, 0.02, 0.28);
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const fin = new THREE.Mesh(finGeo, Materials.missileBody);
    fin.position.z = 0.65;
    fin.rotation.z = angle;
    g.add(fin);
  }
  return g;
}

export function buildCarrier(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'CVN Resolute';

  const hullGeo = new THREE.BoxGeometry(24, 9, 220);
  const hull = new THREE.Mesh(hullGeo, Materials.carrierHull);
  hull.position.y = -4;
  g.add(hull);

  const bowGeo = new THREE.ConeGeometry(12, 30, 4);
  const bow = new THREE.Mesh(bowGeo, Materials.carrierHull);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 0.38, 1);
  bow.position.set(0, -4, -110);
  g.add(bow);

  const deckGeo = new THREE.BoxGeometry(32, 1, 230);
  const deck = new THREE.Mesh(deckGeo, Materials.carrierDeck);
  deck.position.y = 1;
  g.add(deck);

  // Runway centerline stripe + landing area markings
  const stripeGeo = new THREE.PlaneGeometry(1.2, 180);
  const stripe = new THREE.Mesh(stripeGeo, Materials.carrierStripe);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(2, 1.51, 10);
  g.add(stripe);

  for (let i = 0; i < 6; i++) {
    const wireGeo = new THREE.BoxGeometry(20, 0.12, 0.25);
    const wire = new THREE.Mesh(wireGeo, Materials.gear);
    wire.position.set(2, 1.6, 60 + i * 6);
    g.add(wire);
  }

  const catapultGeo = new THREE.PlaneGeometry(2.4, 60);
  const catapult = new THREE.Mesh(catapultGeo, Materials.carrierStripe);
  catapult.rotation.x = -Math.PI / 2;
  catapult.rotation.z = 0.02;
  catapult.position.set(-9, 1.52, -75);
  g.add(catapult);

  // Island structure
  const islandGeo = new THREE.BoxGeometry(9, 16, 34);
  const island = new THREE.Mesh(islandGeo, Materials.carrierIsland);
  island.position.set(11, 9, -10);
  g.add(island);
  const bridgeGeo = new THREE.BoxGeometry(10, 3, 8);
  const bridge = new THREE.Mesh(bridgeGeo, Materials.carrierDeck);
  bridge.position.set(11, 15, -20);
  g.add(bridge);

  const mastGeo = new THREE.CylinderGeometry(0.25, 0.3, 12, 6);
  const mast = new THREE.Mesh(mastGeo, Materials.tower);
  mast.position.set(11, 23, -6);
  g.add(mast);
  const dishGeo = new THREE.BoxGeometry(2.4, 2.4, 0.3);
  const dish = new THREE.Mesh(dishGeo, Materials.radarDish);
  dish.position.set(11, 27.5, -6);
  dish.name = 'carrierRadarDish';
  g.add(dish);

  // Deck lights along the edges
  const lightGeo = new THREE.SphereGeometry(0.18, 6, 6);
  for (let i = -1; i <= 1; i += 2) {
    for (let z = -95; z <= 95; z += 15) {
      const light = new THREE.Mesh(lightGeo, Materials.deckLight);
      light.position.set(i * 15.5, 1.6, z);
      g.add(light);
    }
  }

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });

  return g;
}

export function buildWakeSprite(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(14, 100);
  const mat = new THREE.MeshBasicMaterial({
    map: getSoftDotTexture(),
    color: 0xdfeef2,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function buildRadarSite(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'RadarSite';
  const baseGeo = new THREE.CylinderGeometry(2.2, 2.6, 1.6, 8);
  const base = new THREE.Mesh(baseGeo, Materials.radarBase);
  base.position.y = 0.8;
  g.add(base);

  const dishArm = new THREE.Group();
  dishArm.position.y = 2.4;
  dishArm.name = 'dishArm';
  const dishGeo = new THREE.CylinderGeometry(2.6, 2.6, 0.3, 10, 1, false, 0, Math.PI);
  const dish = new THREE.Mesh(dishGeo, Materials.radarDish);
  dish.rotation.z = Math.PI / 2;
  dish.rotation.y = Math.PI / 2;
  dishArm.add(dish);
  g.add(dishArm);
  (g as any).userData.dishArm = dishArm;

  for (const [x, z] of [
    [5, 4],
    [-5, 3],
  ]) {
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3.6), Materials.building);
    bldg.position.set(x, 1.2, z);
    g.add(bldg);
  }

  return g;
}

export function buildDecorativeBuilding(kind: 'hut' | 'tower' | 'warehouse'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'tower') {
    const towerGeo = new THREE.CylinderGeometry(0.3, 0.4, 22, 6);
    const tower = new THREE.Mesh(towerGeo, Materials.tower);
    tower.position.y = 11;
    g.add(tower);
    for (let y = 4; y < 20; y += 5) {
      const barGeo = new THREE.BoxGeometry(3, 0.15, 0.15);
      const bar = new THREE.Mesh(barGeo, Materials.tower);
      bar.position.y = y;
      g.add(bar);
      const bar2 = bar.clone();
      bar2.rotation.y = Math.PI / 2;
      g.add(bar2);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 6), Materials.deckLight);
    beacon.position.y = 22;
    g.add(beacon);
  } else if (kind === 'warehouse') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 16), Materials.building);
    box.position.y = 2.5;
    g.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.6, 16.4), Materials.roof);
    roof.position.y = 5.3;
    g.add(roof);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), Materials.building);
    box.position.y = 1.5;
    g.add(box);
    const roofGeo = new THREE.ConeGeometry(3.2, 2, 4);
    const roof = new THREE.Mesh(roofGeo, Materials.roof);
    roof.position.y = 4;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
  }
  return g;
}

export function buildPatrolBoat(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 12), Materials.boatHull);
  hull.position.y = 0.5;
  g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 3), Materials.building);
  cabin.position.set(0, 2, -1);
  g.add(cabin);
  return g;
}

export function buildRockyIsland(radius: number, height: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const coneGeo = new THREE.ConeGeometry(radius, height, 6 + Math.floor(rand() * 3));
  const cone = new THREE.Mesh(coneGeo, Materials.rock);
  cone.position.y = height / 2 - 0.6;
  cone.rotation.y = rand() * Math.PI;
  g.add(cone);
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 1.35, 1, 8), Materials.beach);
  beach.position.y = -0.4;
  g.add(beach);
  return g;
}

export function buildHillCluster(seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const r = 18 + rand() * 30;
    const h = 14 + rand() * 26;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), Materials.hill);
    cone.position.set((rand() - 0.5) * 90, h / 2 - 1, (rand() - 0.5) * 90);
    cone.rotation.y = rand() * Math.PI;
    g.add(cone);
  }
  return g;
}

export function buildCloud(seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2f5f7, transparent: true, opacity: 0.75, fog: false });
  const puffs = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < puffs; i++) {
    const size = 10 + rand() * 16;
    const geo = new THREE.IcosahedronGeometry(size, 0);
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set((rand() - 0.5) * 46, (rand() - 0.5) * 8, (rand() - 0.5) * 30);
    g.add(puff);
  }
  return g;
}

export function mulberry32(seedIn: number) {
  let a = seedIn;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
