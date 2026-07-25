import * as THREE from 'three';
import { getConcreteTexture, getHullTexture } from '../ProceduralTextures';
import { GraphicsSettings } from '../GraphicsPresets';

export interface RadarSiteModelResult {
  group: THREE.Group;
  /** Rotating antenna assembly. */
  dishArm: THREE.Object3D;
  /** Points where destruction smoke/scorch is emitted. */
  damagePoints: THREE.Object3D[];
  /** Revealed when the site is destroyed. */
  wreckage: THREE.Object3D;
  dispose(): void;
}

/**
 * The hostile coastal early-warning radar installation.
 *
 * Built as a concrete pad with a parabolic dish on a rotating pedestal, a lattice mast, support
 * buildings, a generator shed and perimeter fencing — enough structure to read clearly as a
 * military target from strike altitude.
 */
export function buildRadarSiteModel(settings: GraphicsSettings): RadarSiteModelResult {
  const group = new THREE.Group();
  group.name = 'radar-site';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const concreteTex = getConcreteTexture();
  const concreteMap = concreteTex.clone();
  concreteMap.needsUpdate = true;
  concreteMap.wrapS = THREE.RepeatWrapping;
  concreteMap.wrapT = THREE.RepeatWrapping;
  concreteMap.repeat.set(4, 4);
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.95, metalness: 0.02 });

  const metalTex = getHullTexture();
  const metalMap = metalTex.clone();
  metalMap.needsUpdate = true;
  metalMap.wrapS = THREE.RepeatWrapping;
  metalMap.wrapT = THREE.RepeatWrapping;
  metalMap.repeat.set(2, 2);
  const metalMat = new THREE.MeshStandardMaterial({ map: metalMap, color: 0x8a8f80, roughness: 0.7, metalness: 0.45 });

  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3c4038, roughness: 0.8, metalness: 0.3 });
  const dishMat = new THREE.MeshStandardMaterial({
    color: 0xb9bdaa,
    roughness: 0.55,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  disposables.push(concreteMat, metalMat, darkMat, dishMat);

  // --- Concrete pad ---
  const padGeo = new THREE.CylinderGeometry(15, 16.5, 1.4, 16);
  disposables.push(padGeo);
  const pad = new THREE.Mesh(padGeo, concreteMat);
  pad.position.y = 0.7;
  pad.receiveShadow = settings.shadowsEnabled;
  group.add(pad);

  // --- Pedestal ---
  const pedestalGeo = new THREE.CylinderGeometry(1.8, 2.4, 4.2, 12);
  disposables.push(pedestalGeo);
  const pedestal = new THREE.Mesh(pedestalGeo, metalMat);
  pedestal.position.y = 3.5;
  pedestal.castShadow = settings.shadowsEnabled;
  group.add(pedestal);

  // --- Rotating antenna assembly ---
  const dishArm = new THREE.Group();
  dishArm.name = 'dishArm';
  dishArm.position.y = 6;

  // Parabolic dish from an open-ended lathe profile — a real curved reflector, not a flat disc.
  const profile: THREE.Vector2[] = [];
  const dishRadius = 5.2;
  const depth = 1.5;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = t * dishRadius;
    // y = r^2 / (4f) parabola
    const y = (r * r) / (4 * (dishRadius * dishRadius) / (4 * depth));
    profile.push(new THREE.Vector2(r, y));
  }
  const dishGeo = new THREE.LatheGeometry(profile, 24);
  disposables.push(dishGeo);
  const dish = new THREE.Mesh(dishGeo, dishMat);
  // Tilt the dish up to a realistic search elevation and face it outward.
  dish.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(28);
  dish.castShadow = settings.shadowsEnabled;
  dishArm.add(dish);

  // Feed horn on a tripod at the dish focus.
  const hornGeo = new THREE.ConeGeometry(0.35, 0.9, 8);
  disposables.push(hornGeo);
  const horn = new THREE.Mesh(hornGeo, darkMat);
  horn.position.set(0, 0.7, -2.1);
  horn.rotation.x = THREE.MathUtils.degToRad(118);
  dishArm.add(horn);

  const strutGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
  disposables.push(strutGeo);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const strut = new THREE.Mesh(strutGeo, metalMat);
    strut.position.set(Math.cos(angle) * 1.4, 0.3, -1.1 + Math.sin(angle) * 1.4);
    strut.rotation.x = THREE.MathUtils.degToRad(58);
    strut.rotation.y = angle;
    dishArm.add(strut);
  }

  // Counterweight arm behind the dish.
  const counterGeo = new THREE.BoxGeometry(1.1, 0.5, 2.2);
  disposables.push(counterGeo);
  const counter = new THREE.Mesh(counterGeo, darkMat);
  counter.position.set(0, -0.6, 1.7);
  dishArm.add(counter);

  group.add(dishArm);

  // --- Lattice mast with an IFF antenna ---
  const mastGeo = new THREE.CylinderGeometry(0.22, 0.3, 16, 6);
  disposables.push(mastGeo);
  const mast = new THREE.Mesh(mastGeo, metalMat);
  mast.position.set(-9, 8, 5);
  mast.castShadow = settings.shadowsEnabled;
  group.add(mast);
  const sparGeo = new THREE.BoxGeometry(3.2, 0.12, 0.12);
  disposables.push(sparGeo);
  for (let y = 3; y < 15; y += 3) {
    const spar = new THREE.Mesh(sparGeo, metalMat);
    spar.position.set(-9, y, 5);
    group.add(spar);
    const spar2 = spar.clone();
    spar2.rotation.y = Math.PI / 2;
    group.add(spar2);
  }

  // --- Support buildings ---
  const buildings: Array<[number, number, number, number, number]> = [
    // [x, z, width, height, depth]
    [9, 6, 6, 3.2, 8],
    [-7, -8, 4.5, 2.6, 5],
    [6, -9, 3.2, 2.2, 3.2],
  ];
  for (const [x, z, w, h, d] of buildings) {
    const geo = new THREE.BoxGeometry(w, h, d);
    disposables.push(geo);
    const building = new THREE.Mesh(geo, concreteMat);
    building.position.set(x, 1.4 + h / 2, z);
    building.castShadow = settings.shadowsEnabled;
    group.add(building);

    const roofGeo = new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4);
    disposables.push(roofGeo);
    const roof = new THREE.Mesh(roofGeo, darkMat);
    roof.position.set(x, 1.4 + h + 0.15, z);
    group.add(roof);
  }

  // --- Perimeter fence posts ---
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 5);
  disposables.push(postGeo);
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, darkMat);
    post.position.set(Math.cos(angle) * 15.4, 2.2, Math.sin(angle) * 15.4);
    group.add(post);
  }

  // --- Wreckage, hidden until destroyed ---
  const wreckage = new THREE.Group();
  wreckage.visible = false;
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1, metalness: 0.1 });
  disposables.push(debrisMat);
  for (let i = 0; i < 14; i++) {
    const size = 0.6 + (i % 5) * 0.5;
    const geo = new THREE.BoxGeometry(size, size * 0.4, size * 0.8);
    disposables.push(geo);
    const chunk = new THREE.Mesh(geo, debrisMat);
    const angle = (i / 14) * Math.PI * 2;
    const r = 2 + (i % 6) * 1.6;
    chunk.position.set(Math.cos(angle) * r, 1.5 + (i % 3) * 0.3, Math.sin(angle) * r);
    chunk.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    wreckage.add(chunk);
  }
  // Scorched ground patch.
  const scorchGeo = new THREE.CircleGeometry(11, 20);
  disposables.push(scorchGeo);
  const scorchMat = new THREE.MeshBasicMaterial({
    color: 0x14100c,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  disposables.push(scorchMat);
  const scorch = new THREE.Mesh(scorchGeo, scorchMat);
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 1.45;
  wreckage.add(scorch);
  group.add(wreckage);

  const damagePoints: THREE.Object3D[] = [];
  for (const [x, y, z] of [
    [0, 6, 0],
    [4, 3, 3],
    [-5, 3, -4],
  ] as Array<[number, number, number]>) {
    const p = new THREE.Object3D();
    p.position.set(x, y, z);
    group.add(p);
    damagePoints.push(p);
  }

  return {
    group,
    dishArm,
    damagePoints,
    wreckage,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
