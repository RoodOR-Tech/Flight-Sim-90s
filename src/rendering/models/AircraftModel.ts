import * as THREE from 'three';
import { buildWing, ellipseRing, loftSections, LoftSection, mirrorX } from './LoftBuilder';
import { getAircraftPanelTexture } from '../ProceduralTextures';
import { GraphicsSettings } from '../GraphicsPresets';

/**
 * Procedural aircraft models.
 *
 * Both airframes are built from lofted superellipse cross-sections and NACA-section wings rather
 * than boxes and cylinders, so silhouettes are curved and shade smoothly. Two distinct airframes
 * are provided:
 *
 *  - `sea-viper`  — the player's twin-engine naval interceptor: chined forebody, blended wing
 *                   roots, twin canted fins, side intakes, tricycle gear.
 *  - `kestrel-9`  — the hostile fighter: a visibly different shape (single fin, delta wing with
 *                   canards, single centre intake, area-ruled waist), not a recolour.
 */
export type AirframeKind = 'sea-viper' | 'kestrel-9';

export interface AircraftModelResult {
  /** Visual root. Parented under the entity root; never used for physics. */
  group: THREE.Group;
  gearGroup: THREE.Group;
  gearDoors: THREE.Object3D[];
  leftFlap: THREE.Object3D;
  rightFlap: THREE.Object3D;
  leftAileron: THREE.Object3D;
  rightAileron: THREE.Object3D;
  rudders: THREE.Object3D[];
  /** Exhaust glow discs, scaled/faded with throttle. */
  engineGlows: THREE.Mesh[];
  /** Afterburner flame cones. */
  afterburnerFlames: THREE.Mesh[];
  /** World-space emitters for engine smoke/afterburner particles. */
  engineEffectPoints: THREE.Object3D[];
  /** Weapon pylons for missiles. */
  hardpoints: THREE.Object3D[];
  cannonMuzzle: THREE.Object3D;
  navLights: THREE.Mesh[];
  /** Points where damage smoke is emitted. */
  damageEffectPoints: THREE.Object3D[];
  /** Approximate length along Z, used for collision-radius sanity checks. */
  length: number;
  dispose(): void;
}

const SEGMENTS = 16;

function panelMaterial(color: string, seed: number, roughness: number): THREE.MeshStandardMaterial {
  const map = getAircraftPanelTexture(color, seed);
  const tex = map.clone();
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,
    roughness,
    metalness: 0.34,
  });
}

function canopyMaterial(tint: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    roughness: 0.06,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    // A clearcoat gives the canopy a distinct specular sheen against the fuselage.
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
  });
}

function makeGlowDisc(radius: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 14), mat);
  mesh.renderOrder = 6;
  return mesh;
}

function makeAfterburnerFlame(radius: number): THREE.Mesh {
  // A stretched cone, additively blended, standing in for the shock diamond plume.
  const geo = new THREE.ConeGeometry(radius, radius * 7.5, 12, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, radius * 3.75);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x88bbff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 7;
  return mesh;
}

/** Landing-gear leg: oleo strut, wheel, and a hinged door. */
function buildGearLeg(
  strutLength: number,
  wheelRadius: number,
  metalMat: THREE.Material,
  tyreMat: THREE.Material,
  doorMat: THREE.Material,
): { leg: THREE.Group; door: THREE.Mesh } {
  const leg = new THREE.Group();

  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, strutLength, 8), metalMat);
  strut.position.y = -strutLength / 2;
  leg.add(strut);

  // Oleo shock sleeve
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.095, 0.095, strutLength * 0.4, 8),
    metalMat,
  );
  sleeve.position.y = -strutLength * 0.28;
  leg.add(sleeve);

  const wheel = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, wheelRadius * 0.42, 8, 14), tyreMat);
  wheel.rotation.y = Math.PI / 2;
  wheel.position.y = -strutLength;
  leg.add(wheel);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(wheelRadius * 0.45, wheelRadius * 0.45, wheelRadius * 0.75, 10),
    metalMat,
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.y = -strutLength;
  leg.add(hub);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, strutLength * 0.9, 0.6), doorMat);
  door.position.set(0.16, -strutLength * 0.45, 0);

  return { leg, door };
}

// ---------------------------------------------------------------------------
// Sea Viper — player airframe
// ---------------------------------------------------------------------------

function buildSeaViper(settings: GraphicsSettings): AircraftModelResult {
  const group = new THREE.Group();
  group.name = 'sea-viper';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const skinMat = panelMaterial('#6a737a', 11, 0.52);
  const darkMat = panelMaterial('#39424a', 12, 0.58);
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.38, metalness: 0.85 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.95, metalness: 0.02 });
  const intakeMat = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.85, metalness: 0.1 });
  disposables.push(skinMat, darkMat, metalMat, tyreMat, intakeMat);

  // --- Fuselage: lofted stations from a pointed radome to twin-engine tail ---
  // Nose at -Z, tail at +Z (matching the game's forward = -Z convention).
  const stations: Array<[number, number, number, number, number]> = [
    // [z, halfWidth, halfHeight, squareness, flatBottom]
    [-4.35, 0.02, 0.02, 0, 0],
    [-4.1, 0.12, 0.1, 0.1, 0.1],
    [-3.6, 0.26, 0.22, 0.2, 0.2],
    [-3.0, 0.38, 0.31, 0.35, 0.3],
    [-2.4, 0.48, 0.38, 0.5, 0.4],
    [-1.7, 0.58, 0.44, 0.6, 0.45],
    [-0.9, 0.66, 0.48, 0.65, 0.5],
    [0.0, 0.7, 0.5, 0.7, 0.5],
    [0.9, 0.72, 0.5, 0.72, 0.5],
    [1.8, 0.7, 0.48, 0.7, 0.45],
    [2.6, 0.66, 0.45, 0.68, 0.4],
    [3.3, 0.62, 0.42, 0.65, 0.35],
    [3.9, 0.58, 0.4, 0.6, 0.3],
  ];
  const fuselageSections: LoftSection[] = stations.map(([z, hw, hh, sq, fb]) => ({
    z,
    points: ellipseRing(hw, hh, SEGMENTS, sq, fb),
  }));
  const fuselageGeo = loftSections(fuselageSections, true, false);
  disposables.push(fuselageGeo);
  const fuselage = new THREE.Mesh(fuselageGeo, skinMat);
  group.add(fuselage);

  // Radome tip (slightly darker dielectric nose cone)
  const radomeSections: LoftSection[] = [
    { z: -4.62, points: ellipseRing(0.015, 0.015, SEGMENTS, 0, 0) },
    { z: -4.5, points: ellipseRing(0.07, 0.062, SEGMENTS, 0, 0) },
    { z: -4.34, points: ellipseRing(0.125, 0.108, SEGMENTS, 0.1, 0.05) },
  ];
  const radomeGeo = loftSections(radomeSections, true, false);
  disposables.push(radomeGeo);
  const radome = new THREE.Mesh(radomeGeo, darkMat);
  group.add(radome);

  // --- Leading-edge root extensions (chines) blending nose into wing ---
  const lexShape = new THREE.Shape();
  lexShape.moveTo(0, 0);
  lexShape.lineTo(2.6, -0.16);
  lexShape.lineTo(2.75, -0.42);
  lexShape.lineTo(0.1, -0.3);
  lexShape.closePath();
  const lexGeo = new THREE.ExtrudeGeometry(lexShape, { depth: 0.09, bevelEnabled: false });
  lexGeo.rotateY(Math.PI / 2);
  disposables.push(lexGeo);
  for (const side of [1, -1]) {
    const lex = new THREE.Mesh(lexGeo, skinMat);
    lex.position.set(side * 0.6, 0.04, -2.7);
    lex.scale.z = side;
    group.add(lex);
  }

  // --- Wings: swept, tapered, real airfoil section, blended root ---
  const wingGeo = buildWing({
    rootChord: 2.45,
    tipChord: 0.85,
    span: 3.35,
    sweep: THREE.MathUtils.degToRad(34),
    thickness: 0.11,
    dihedral: 0.02,
    stations: 9,
    rootBlend: 0.26,
  });
  disposables.push(wingGeo);
  const wingRight = new THREE.Mesh(wingGeo, skinMat);
  wingRight.rotation.set(0, 0, 0);
  wingRight.position.set(0.62, -0.12, -0.85);
  group.add(wingRight);

  const wingLeftGeo = mirrorX(wingGeo);
  disposables.push(wingLeftGeo);
  const wingLeft = new THREE.Mesh(wingLeftGeo, skinMat);
  wingLeft.position.set(-0.62, -0.12, -0.85);
  group.add(wingLeft);

  // --- Control surfaces (hinged children so they can deflect) ---
  const flapGeo = new THREE.BoxGeometry(1.15, 0.055, 0.42);
  const aileronGeo = new THREE.BoxGeometry(0.95, 0.05, 0.32);
  disposables.push(flapGeo, aileronGeo);

  const rightFlap = new THREE.Mesh(flapGeo, darkMat);
  rightFlap.position.set(1.35, -0.11, 1.42);
  group.add(rightFlap);
  const leftFlap = new THREE.Mesh(flapGeo, darkMat);
  leftFlap.position.set(-1.35, -0.11, 1.42);
  group.add(leftFlap);

  const rightAileron = new THREE.Mesh(aileronGeo, darkMat);
  rightAileron.position.set(2.85, -0.09, 1.95);
  group.add(rightAileron);
  const leftAileron = new THREE.Mesh(aileronGeo, darkMat);
  leftAileron.position.set(-2.85, -0.09, 1.95);
  group.add(leftAileron);

  // --- Side intakes with dark inlet ducts ---
  const intakeSections: LoftSection[] = [
    { z: -1.5, points: ellipseRing(0.3, 0.34, 12, 0.55, 0.1) },
    { z: -0.6, points: ellipseRing(0.33, 0.36, 12, 0.6, 0.1) },
    { z: 0.6, points: ellipseRing(0.32, 0.34, 12, 0.6, 0.1) },
  ];
  const intakeGeo = loftSections(intakeSections, false, false);
  disposables.push(intakeGeo);
  for (const side of [1, -1]) {
    const intake = new THREE.Mesh(intakeGeo, skinMat);
    intake.position.set(side * 0.82, -0.12, 0);
    group.add(intake);
    // Dark inlet face so the intake reads as an opening rather than a bump.
    const inletGeo = new THREE.CircleGeometry(0.27, 12);
    disposables.push(inletGeo);
    const inlet = new THREE.Mesh(inletGeo, intakeMat);
    inlet.position.set(side * 0.82, -0.12, -1.52);
    group.add(inlet);
  }

  // --- Engine nacelles and nozzles ---
  const nacelleSections: LoftSection[] = [
    { z: 2.4, points: ellipseRing(0.34, 0.34, 12, 0.15, 0) },
    { z: 3.4, points: ellipseRing(0.33, 0.33, 12, 0.1, 0) },
    { z: 4.05, points: ellipseRing(0.29, 0.29, 12, 0.05, 0) },
    { z: 4.3, points: ellipseRing(0.31, 0.31, 12, 0, 0) },
  ];
  const nacelleGeo = loftSections(nacelleSections, false, false);
  disposables.push(nacelleGeo);

  const engineGlows: THREE.Mesh[] = [];
  const afterburnerFlames: THREE.Mesh[] = [];
  const engineEffectPoints: THREE.Object3D[] = [];

  for (const side of [1, -1]) {
    const nacelle = new THREE.Mesh(nacelleGeo, darkMat);
    nacelle.position.set(side * 0.42, -0.06, 0);
    group.add(nacelle);

    // Serrated nozzle ring
    const nozzleGeo = new THREE.CylinderGeometry(0.3, 0.27, 0.28, 12, 1, true);
    nozzleGeo.rotateX(Math.PI / 2);
    disposables.push(nozzleGeo);
    const nozzle = new THREE.Mesh(nozzleGeo, metalMat);
    nozzle.position.set(side * 0.42, -0.06, 4.42);
    group.add(nozzle);

    const glow = makeGlowDisc(0.26, 0xff9a3c);
    glow.position.set(side * 0.42, -0.06, 4.5);
    group.add(glow);
    engineGlows.push(glow);
    disposables.push(glow.geometry, glow.material as THREE.Material);

    const flame = makeAfterburnerFlame(0.22);
    flame.position.set(side * 0.42, -0.06, 4.52);
    group.add(flame);
    afterburnerFlames.push(flame);
    disposables.push(flame.geometry, flame.material as THREE.Material);

    const point = new THREE.Object3D();
    point.position.set(side * 0.42, -0.06, 4.7);
    group.add(point);
    engineEffectPoints.push(point);
  }

  // --- Twin canted vertical stabilisers ---
  const finGeo = buildWing({
    rootChord: 1.5,
    tipChord: 0.62,
    span: 1.35,
    sweep: THREE.MathUtils.degToRad(38),
    thickness: 0.085,
    stations: 6,
    rootBlend: 0.2,
  });
  disposables.push(finGeo);
  const rudders: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const fin = new THREE.Mesh(finGeo, skinMat);
    // buildWing emits span along +X; rotate +90 deg about Z to stand the span up vertically,
    // then cant the top outboard by a further ~16 deg (the twin-fin look).
    fin.rotation.z = Math.PI / 2 - side * THREE.MathUtils.degToRad(16);
    fin.position.set(side * 0.58, 0.3, 1.5);
    group.add(fin);

    const rudderGeo = new THREE.BoxGeometry(0.05, 0.8, 0.3);
    disposables.push(rudderGeo);
    const rudder = new THREE.Mesh(rudderGeo, darkMat);
    rudder.position.set(side * 0.92, 1.05, 2.72);
    rudder.rotation.z = -side * THREE.MathUtils.degToRad(16);
    group.add(rudder);
    rudders.push(rudder);
  }

  // --- Horizontal stabilisers (all-moving tailerons) ---
  const stabGeo = buildWing({
    rootChord: 1.05,
    tipChord: 0.42,
    span: 1.3,
    sweep: THREE.MathUtils.degToRad(30),
    thickness: 0.09,
    stations: 5,
    rootBlend: 0.18,
  });
  disposables.push(stabGeo);
  const stabRight = new THREE.Mesh(stabGeo, skinMat);
  stabRight.position.set(0.5, 0.02, 2.85);
  group.add(stabRight);
  const stabLeftGeo = mirrorX(stabGeo);
  disposables.push(stabLeftGeo);
  const stabLeft = new THREE.Mesh(stabLeftGeo, skinMat);
  stabLeft.position.set(-0.5, 0.02, 2.85);
  group.add(stabLeft);

  // --- Canopy: lofted bubble over a dark cockpit tub ---
  const tubGeo = new THREE.BoxGeometry(0.5, 0.3, 1.25);
  disposables.push(tubGeo);
  const tub = new THREE.Mesh(tubGeo, intakeMat);
  tub.position.set(0, 0.42, -1.55);
  group.add(tub);

  // Simple seat + headrest so the cockpit is not an empty black hole up close.
  const seatGeo = new THREE.BoxGeometry(0.3, 0.34, 0.24);
  disposables.push(seatGeo);
  const seat = new THREE.Mesh(seatGeo, darkMat);
  seat.position.set(0, 0.5, -1.25);
  group.add(seat);

  const canopySections: LoftSection[] = [
    { z: -2.35, points: ellipseRing(0.16, 0.1, 12, 0.2, 0.6) },
    { z: -2.05, points: ellipseRing(0.3, 0.26, 12, 0.15, 0.7) },
    { z: -1.7, points: ellipseRing(0.36, 0.32, 12, 0.1, 0.75) },
    { z: -1.2, points: ellipseRing(0.36, 0.31, 12, 0.1, 0.75) },
    { z: -0.85, points: ellipseRing(0.3, 0.22, 12, 0.2, 0.8) },
    { z: -0.55, points: ellipseRing(0.2, 0.12, 12, 0.3, 0.85) },
  ];
  const canopyGeo = loftSections(canopySections, false, false);
  disposables.push(canopyGeo);
  const canopyMat = canopyMaterial(0x2b4a52);
  disposables.push(canopyMat);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 0.42;
  group.add(canopy);

  // Canopy frame arch
  const frameGeo = new THREE.TorusGeometry(0.36, 0.028, 6, 14, Math.PI);
  disposables.push(frameGeo);
  const frame = new THREE.Mesh(frameGeo, darkMat);
  frame.position.set(0, 0.44, -2.05);
  group.add(frame);

  // --- Landing gear ---
  const gearGroup = new THREE.Group();
  const gearDoors: THREE.Object3D[] = [];
  const doorMat = darkMat;

  const nose = buildGearLeg(0.72, 0.17, metalMat, tyreMat, doorMat);
  nose.leg.position.set(0, -0.44, -2.5);
  gearGroup.add(nose.leg);
  nose.door.position.set(0.14, -0.72, -2.5);
  gearGroup.add(nose.door);
  gearDoors.push(nose.door);

  for (const side of [1, -1]) {
    const main = buildGearLeg(0.85, 0.22, metalMat, tyreMat, doorMat);
    main.leg.position.set(side * 0.78, -0.42, 0.55);
    gearGroup.add(main.leg);
    main.door.position.set(side * 0.95, -0.78, 0.55);
    gearGroup.add(main.door);
    gearDoors.push(main.door);
  }

  // Arresting hook — a naval detail that reads clearly from the chase camera.
  const hookGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6);
  disposables.push(hookGeo);
  const hook = new THREE.Mesh(hookGeo, metalMat);
  hook.rotation.x = THREE.MathUtils.degToRad(72);
  hook.position.set(0, -0.4, 3.4);
  group.add(hook);

  group.add(gearGroup);

  // --- Hardpoints + missile bodies ---
  const hardpoints: THREE.Object3D[] = [];
  const pylonGeo = new THREE.BoxGeometry(0.09, 0.2, 0.55);
  disposables.push(pylonGeo);
  const hardpointOffsets: Array<[number, number]> = [
    [1.35, 0.55],
    [-1.35, 0.55],
    [2.25, 1.15],
    [-2.25, 1.15],
  ];
  for (const [x, z] of hardpointOffsets) {
    const pylon = new THREE.Mesh(pylonGeo, darkMat);
    pylon.position.set(x, -0.26, z);
    group.add(pylon);

    const hp = new THREE.Object3D();
    hp.position.set(x, -0.44, z);
    group.add(hp);
    hardpoints.push(hp);
  }

  // Wingtip nav lights
  const navLights: THREE.Mesh[] = [];
  const navGeo = new THREE.SphereGeometry(0.06, 8, 6);
  disposables.push(navGeo);
  const navRedMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const navGreenMat = new THREE.MeshBasicMaterial({ color: 0x2aff5a });
  const navWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  disposables.push(navRedMat, navGreenMat, navWhiteMat);

  const rightNav = new THREE.Mesh(navGeo, navGreenMat);
  rightNav.position.set(3.05, -0.06, 1.35);
  group.add(rightNav);
  navLights.push(rightNav);

  const leftNav = new THREE.Mesh(navGeo, navRedMat);
  leftNav.position.set(-3.05, -0.06, 1.35);
  group.add(leftNav);
  navLights.push(leftNav);

  const tailNav = new THREE.Mesh(navGeo, navWhiteMat);
  tailNav.position.set(0, 0.55, 3.5);
  group.add(tailNav);
  navLights.push(tailNav);

  // Cannon muzzle (starboard wing root, like a real fighter's gun port)
  const cannonMuzzle = new THREE.Object3D();
  cannonMuzzle.position.set(0.55, -0.02, -2.2);
  group.add(cannonMuzzle);
  const portGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8);
  portGeo.rotateX(Math.PI / 2);
  disposables.push(portGeo);
  const port = new THREE.Mesh(portGeo, intakeMat);
  port.position.set(0.55, -0.02, -2.25);
  group.add(port);

  const damageEffectPoints: THREE.Object3D[] = [];
  for (const [x, y, z] of [
    [0.5, -0.1, 2.0],
    [-0.5, -0.1, 2.0],
    [0, 0.2, 0.5],
  ] as Array<[number, number, number]>) {
    const p = new THREE.Object3D();
    p.position.set(x, y, z);
    group.add(p);
    damageEffectPoints.push(p);
  }

  applyShadowPolicy(group, settings);

  return {
    group,
    gearGroup,
    gearDoors,
    leftFlap,
    rightFlap,
    leftAileron,
    rightAileron,
    rudders,
    engineGlows,
    afterburnerFlames,
    engineEffectPoints,
    hardpoints,
    cannonMuzzle,
    navLights,
    damageEffectPoints,
    length: 9.2,
    dispose: () => disposeAll(disposables),
  };
}

// ---------------------------------------------------------------------------
// Kestrel-9 — hostile airframe (deliberately different silhouette)
// ---------------------------------------------------------------------------

function buildKestrel9(settings: GraphicsSettings): AircraftModelResult {
  const group = new THREE.Group();
  group.name = 'kestrel-9';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  // Desaturated sand/brown scheme with red trim — reads as "other side" at a glance.
  const skinMat = panelMaterial('#7d6a52', 21, 0.62);
  const darkMat = panelMaterial('#4a3a2c', 22, 0.66);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9c2b22, roughness: 0.55, metalness: 0.3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9ea1a4, roughness: 0.44, metalness: 0.8 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.95, metalness: 0.02 });
  const intakeMat = new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.9, metalness: 0.08 });
  disposables.push(skinMat, darkMat, trimMat, metalMat, tyreMat, intakeMat);

  // --- Fuselage: area-ruled "wasp waist", wider flat forebody, single tail ---
  const stations: Array<[number, number, number, number, number]> = [
    [-4.9, 0.02, 0.02, 0, 0],
    [-4.5, 0.14, 0.1, 0.2, 0.2],
    [-3.9, 0.32, 0.2, 0.45, 0.45],
    [-3.2, 0.5, 0.28, 0.7, 0.6],
    [-2.4, 0.62, 0.34, 0.8, 0.65],
    [-1.5, 0.66, 0.4, 0.75, 0.6],
    [-0.5, 0.58, 0.44, 0.6, 0.5],
    [0.4, 0.5, 0.46, 0.45, 0.4],
    [1.4, 0.56, 0.46, 0.5, 0.4],
    [2.4, 0.6, 0.44, 0.55, 0.35],
    [3.3, 0.54, 0.4, 0.5, 0.3],
    [4.0, 0.44, 0.36, 0.4, 0.25],
  ];
  const fuselageGeo = loftSections(
    stations.map(([z, hw, hh, sq, fb]) => ({ z, points: ellipseRing(hw, hh, SEGMENTS, sq, fb) })),
    true,
    false,
  );
  disposables.push(fuselageGeo);
  group.add(new THREE.Mesh(fuselageGeo, skinMat));

  // --- Single chin intake (vs. the Viper's paired side intakes) ---
  const intakeSections: LoftSection[] = [
    { z: -3.5, points: ellipseRing(0.44, 0.2, 12, 0.7, 0.2) },
    { z: -2.6, points: ellipseRing(0.48, 0.24, 12, 0.7, 0.2) },
    { z: -1.4, points: ellipseRing(0.44, 0.22, 12, 0.65, 0.2) },
  ];
  const chinGeo = loftSections(intakeSections, false, false);
  disposables.push(chinGeo);
  const chin = new THREE.Mesh(chinGeo, darkMat);
  chin.position.set(0, -0.42, 0);
  group.add(chin);
  const inletGeo = new THREE.PlaneGeometry(0.78, 0.34);
  disposables.push(inletGeo);
  const inlet = new THREE.Mesh(inletGeo, intakeMat);
  inlet.position.set(0, -0.42, -3.52);
  group.add(inlet);

  // --- Canards: a distinctive forward-control surface the player aircraft lacks ---
  const canardGeo = buildWing({
    rootChord: 0.8,
    tipChord: 0.32,
    span: 1.0,
    sweep: THREE.MathUtils.degToRad(42),
    thickness: 0.08,
    stations: 5,
    rootBlend: 0.2,
  });
  disposables.push(canardGeo);
  const canardRight = new THREE.Mesh(canardGeo, trimMat);
  canardRight.position.set(0.52, 0.16, -2.6);
  canardRight.rotation.x = THREE.MathUtils.degToRad(-4);
  group.add(canardRight);
  const canardLeftGeo = mirrorX(canardGeo);
  disposables.push(canardLeftGeo);
  const canardLeft = new THREE.Mesh(canardLeftGeo, trimMat);
  canardLeft.position.set(-0.52, 0.16, -2.6);
  canardLeft.rotation.x = THREE.MathUtils.degToRad(-4);
  group.add(canardLeft);

  // --- Cropped delta wing (much broader chord than the Viper's swept wing) ---
  const wingGeo = buildWing({
    rootChord: 4.1,
    tipChord: 0.7,
    span: 3.15,
    sweep: THREE.MathUtils.degToRad(52),
    thickness: 0.09,
    dihedral: -0.03, // slight anhedral
    stations: 9,
    rootBlend: 0.3,
  });
  disposables.push(wingGeo);
  const wingRight = new THREE.Mesh(wingGeo, skinMat);
  wingRight.position.set(0.5, -0.16, -1.3);
  group.add(wingRight);
  const wingLeftGeo = mirrorX(wingGeo);
  disposables.push(wingLeftGeo);
  const wingLeft = new THREE.Mesh(wingLeftGeo, skinMat);
  wingLeft.position.set(-0.5, -0.16, -1.3);
  group.add(wingLeft);

  const flapGeo = new THREE.BoxGeometry(1.3, 0.05, 0.4);
  const aileronGeo = new THREE.BoxGeometry(0.9, 0.05, 0.3);
  disposables.push(flapGeo, aileronGeo);
  const rightFlap = new THREE.Mesh(flapGeo, darkMat);
  rightFlap.position.set(1.3, -0.16, 1.95);
  group.add(rightFlap);
  const leftFlap = new THREE.Mesh(flapGeo, darkMat);
  leftFlap.position.set(-1.3, -0.16, 1.95);
  group.add(leftFlap);
  const rightAileron = new THREE.Mesh(aileronGeo, darkMat);
  rightAileron.position.set(2.6, -0.14, 2.15);
  group.add(rightAileron);
  const leftAileron = new THREE.Mesh(aileronGeo, darkMat);
  leftAileron.position.set(-2.6, -0.14, 2.15);
  group.add(leftAileron);

  // --- Single large swept fin with a red trim band ---
  const finGeo = buildWing({
    rootChord: 2.1,
    tipChord: 0.75,
    span: 1.85,
    sweep: THREE.MathUtils.degToRad(44),
    thickness: 0.08,
    stations: 6,
    rootBlend: 0.2,
  });
  disposables.push(finGeo);
  const fin = new THREE.Mesh(finGeo, skinMat);
  // Stand the span (emitted along +X) upright; no cant, so the single fin reads as vertical.
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 0.36, 1.5);
  group.add(fin);

  const trimGeo = new THREE.BoxGeometry(0.07, 0.5, 0.7);
  disposables.push(trimGeo);
  const trimBand = new THREE.Mesh(trimGeo, trimMat);
  trimBand.position.set(0, 1.95, 2.5);
  group.add(trimBand);

  const rudderGeo = new THREE.BoxGeometry(0.06, 1.3, 0.4);
  disposables.push(rudderGeo);
  const rudder = new THREE.Mesh(rudderGeo, darkMat);
  rudder.position.set(0, 1.15, 3.05);
  group.add(rudder);

  // Ventral strakes instead of horizontal tails
  const strakeGeo = new THREE.BoxGeometry(0.06, 0.5, 0.9);
  disposables.push(strakeGeo);
  for (const side of [1, -1]) {
    const strake = new THREE.Mesh(strakeGeo, darkMat);
    strake.position.set(side * 0.5, -0.5, 2.9);
    strake.rotation.z = side * THREE.MathUtils.degToRad(22);
    group.add(strake);
  }

  // --- Single large engine nozzle (vs. the Viper's twin) ---
  const nozzleGeo = new THREE.CylinderGeometry(0.42, 0.36, 0.45, 14, 1, true);
  nozzleGeo.rotateX(Math.PI / 2);
  disposables.push(nozzleGeo);
  const nozzle = new THREE.Mesh(nozzleGeo, metalMat);
  nozzle.position.set(0, 0, 4.15);
  group.add(nozzle);

  const engineGlows: THREE.Mesh[] = [];
  const afterburnerFlames: THREE.Mesh[] = [];
  const engineEffectPoints: THREE.Object3D[] = [];

  const glow = makeGlowDisc(0.36, 0xff7a2c);
  glow.position.set(0, 0, 4.3);
  group.add(glow);
  engineGlows.push(glow);
  disposables.push(glow.geometry, glow.material as THREE.Material);

  const flame = makeAfterburnerFlame(0.32);
  flame.position.set(0, 0, 4.32);
  group.add(flame);
  afterburnerFlames.push(flame);
  disposables.push(flame.geometry, flame.material as THREE.Material);

  const effectPoint = new THREE.Object3D();
  effectPoint.position.set(0, 0, 4.6);
  group.add(effectPoint);
  engineEffectPoints.push(effectPoint);

  // --- Canopy: lower, more faired than the Viper's bubble ---
  const canopySections: LoftSection[] = [
    { z: -3.0, points: ellipseRing(0.14, 0.08, 12, 0.3, 0.6) },
    { z: -2.6, points: ellipseRing(0.28, 0.2, 12, 0.25, 0.7) },
    { z: -2.1, points: ellipseRing(0.32, 0.24, 12, 0.2, 0.75) },
    { z: -1.6, points: ellipseRing(0.28, 0.2, 12, 0.3, 0.8) },
    { z: -1.2, points: ellipseRing(0.18, 0.1, 12, 0.4, 0.85) },
  ];
  const canopyGeo = loftSections(canopySections, false, false);
  disposables.push(canopyGeo);
  const canopyMat = canopyMaterial(0x3a2a1e);
  disposables.push(canopyMat);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 0.34;
  group.add(canopy);

  // --- Gear (retracted in flight, but present for completeness) ---
  const gearGroup = new THREE.Group();
  const gearDoors: THREE.Object3D[] = [];
  const noseGear = buildGearLeg(0.7, 0.16, metalMat, tyreMat, darkMat);
  noseGear.leg.position.set(0, -0.4, -2.9);
  gearGroup.add(noseGear.leg);
  gearDoors.push(noseGear.door);
  for (const side of [1, -1]) {
    const main = buildGearLeg(0.8, 0.2, metalMat, tyreMat, darkMat);
    main.leg.position.set(side * 0.7, -0.4, 0.6);
    gearGroup.add(main.leg);
    gearDoors.push(main.door);
  }
  gearGroup.visible = false;
  group.add(gearGroup);

  // Hardpoints
  const hardpoints: THREE.Object3D[] = [];
  for (const [x, z] of [
    [1.2, 0.9],
    [-1.2, 0.9],
  ] as Array<[number, number]>) {
    const hp = new THREE.Object3D();
    hp.position.set(x, -0.42, z);
    group.add(hp);
    hardpoints.push(hp);
  }

  const navLights: THREE.Mesh[] = [];
  const navGeo = new THREE.SphereGeometry(0.055, 8, 6);
  disposables.push(navGeo);
  const navRedMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const navGreenMat = new THREE.MeshBasicMaterial({ color: 0x2aff5a });
  disposables.push(navRedMat, navGreenMat);
  const rNav = new THREE.Mesh(navGeo, navGreenMat);
  rNav.position.set(2.9, -0.2, 2.2);
  group.add(rNav);
  navLights.push(rNav);
  const lNav = new THREE.Mesh(navGeo, navRedMat);
  lNav.position.set(-2.9, -0.2, 2.2);
  group.add(lNav);
  navLights.push(lNav);

  const cannonMuzzle = new THREE.Object3D();
  cannonMuzzle.position.set(0.42, 0.1, -2.9);
  group.add(cannonMuzzle);

  const damageEffectPoints: THREE.Object3D[] = [];
  for (const [x, y, z] of [
    [0, 0.1, 2.4],
    [0.4, -0.1, 0.8],
  ] as Array<[number, number, number]>) {
    const p = new THREE.Object3D();
    p.position.set(x, y, z);
    group.add(p);
    damageEffectPoints.push(p);
  }

  applyShadowPolicy(group, settings);

  return {
    group,
    gearGroup,
    gearDoors,
    leftFlap,
    rightFlap,
    leftAileron,
    rightAileron,
    rudders: [rudder],
    engineGlows,
    afterburnerFlames,
    engineEffectPoints,
    hardpoints,
    cannonMuzzle,
    navLights,
    damageEffectPoints,
    length: 10.0,
    dispose: () => disposeAll(disposables),
  };
}

function applyShadowPolicy(group: THREE.Group, settings: GraphicsSettings) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mat = o.material as THREE.Material;
      // Transparent/additive parts (canopy, glows, flames) must never cast shadows.
      const isTransparent = Array.isArray(mat) ? false : mat.transparent === true;
      o.castShadow = settings.shadowsEnabled && !isTransparent;
      o.receiveShadow = false;
    }
  });
}

function disposeAll(items: Array<THREE.BufferGeometry | THREE.Material>) {
  for (const item of items) item.dispose();
}

export function buildAircraftModel(kind: AirframeKind, settings: GraphicsSettings): AircraftModelResult {
  return kind === 'sea-viper' ? buildSeaViper(settings) : buildKestrel9(settings);
}
