import * as THREE from 'three';
import { getCarrierDeckTexture, getHullTexture } from '../ProceduralTextures';
import { GraphicsSettings } from '../GraphicsPresets';

/**
 * Named attachment points on the carrier, in carrier-local space.
 *
 * These are the gameplay contract between the visual model and the launch/landing systems.
 * The model is built around them, and `CarrierModel.attachments` exposes the resolved
 * `Object3D`s so gameplay code never has to hard-code offsets into the geometry.
 *
 * Local frame: +X starboard, +Y up, -Z forward (bow). Deck surface sits at y = DECK_Y.
 */
export const CARRIER_ATTACHMENTS = {
  catapultStart: new THREE.Vector3(-9, 1.5, -95),
  catapultEnd: new THREE.Vector3(-9, 1.5, -45),
  landingZoneStart: new THREE.Vector3(2, 1.5, 50),
  landingZoneCenter: new THREE.Vector3(2, 1.5, 74),
  landingZoneEnd: new THREE.Vector3(2, 1.5, 98),
  arrestingPoint: new THREE.Vector3(2, 1.5, 74),
  lineupReference: new THREE.Vector3(2, 1.5, 120),
  glideSlopeReference: new THREE.Vector3(2, 14, 150),
  carrierRadar: new THREE.Vector3(11, 27.5, -6),
} as const;

export type CarrierAttachmentName = keyof typeof CARRIER_ATTACHMENTS;

export const DECK_Y = 1.5;
/** Angle of the landing deck relative to the hull centreline (radians). */
export const ANGLED_DECK_RAD = THREE.MathUtils.degToRad(9);

const HULL_LENGTH = 232;
const HULL_WIDTH = 26;
const DECK_LENGTH = 236;

export interface CarrierModelResult {
  group: THREE.Group;
  attachments: Record<CarrierAttachmentName, THREE.Object3D>;
  radarDish: THREE.Object3D;
  wake: THREE.Mesh;
  deckLights: THREE.Object3D[];
}

function hullMaterial(): THREE.MeshStandardMaterial {
  const tex = getHullTexture();
  const map = tex.clone();
  map.needsUpdate = true;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 2);
  return new THREE.MeshStandardMaterial({ color: 0x555c61, map, roughness: 0.86, metalness: 0.16 });
}

/**
 * Builds the hull as an extruded, chamfered cross-section rather than a plain box, so the
 * waterline tapers and the bow rakes forward like a real ship.
 */
function buildHull(mat: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  // Cross-section profile in the X/Y plane: narrower at the keel, flaring out toward the deck.
  const shape = new THREE.Shape();
  shape.moveTo(-HULL_WIDTH * 0.32, -9);
  shape.lineTo(HULL_WIDTH * 0.32, -9);
  shape.lineTo(HULL_WIDTH * 0.5, -3.5);
  shape.lineTo(HULL_WIDTH * 0.5, 1.2);
  shape.lineTo(-HULL_WIDTH * 0.5, 1.2);
  shape.lineTo(-HULL_WIDTH * 0.5, -3.5);
  shape.closePath();

  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: HULL_LENGTH, bevelEnabled: false, steps: 1 }),
    mat,
  );
  hull.rotation.y = Math.PI; // extrude runs along +Z; rotate so it runs forward (-Z)
  hull.position.z = HULL_LENGTH / 2 - 6;
  group.add(hull);

  // Raked bow: a tapered wedge closing the front of the hull.
  const bowShape = new THREE.Shape();
  bowShape.moveTo(-HULL_WIDTH * 0.5, 1.2);
  bowShape.lineTo(HULL_WIDTH * 0.5, 1.2);
  bowShape.lineTo(HULL_WIDTH * 0.16, -6);
  bowShape.lineTo(-HULL_WIDTH * 0.16, -6);
  bowShape.closePath();
  const bow = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bowShape, { depth: 26, bevelEnabled: false }),
    mat,
  );
  bow.rotation.x = 0;
  bow.position.set(0, 0, -HULL_LENGTH / 2 - 26 - 6);
  // Taper the bow by scaling its far end inward.
  bow.scale.z = 1;
  group.add(bow);

  const bowTip = new THREE.Mesh(new THREE.ConeGeometry(HULL_WIDTH * 0.36, 34, 6, 1), mat);
  bowTip.rotation.x = -Math.PI / 2;
  bowTip.rotation.y = Math.PI / 6;
  bowTip.scale.set(1, 1, 0.42);
  bowTip.position.set(0, -3.4, -HULL_LENGTH / 2 - 30);
  group.add(bowTip);

  // Squared-off stern.
  const stern = new THREE.Mesh(new THREE.BoxGeometry(HULL_WIDTH, 10.5, 8), mat);
  stern.position.set(0, -3.9, HULL_LENGTH / 2 - 2);
  group.add(stern);

  return group;
}

/** Flight deck: main axial deck plus the angled landing deck and its port-side sponson. */
function buildDeck(deckMat: THREE.Material, structureMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  const main = new THREE.Mesh(new THREE.BoxGeometry(34, 1.1, DECK_LENGTH), deckMat);
  main.position.set(0, DECK_Y - 0.55, 0);
  main.receiveShadow = true;
  group.add(main);

  // Angled landing area, canted to port — the defining visual feature of a modern carrier.
  const angled = new THREE.Mesh(new THREE.BoxGeometry(23, 1.1, 150), deckMat);
  angled.position.set(-11.5, DECK_Y - 0.55, 34);
  angled.rotation.y = -ANGLED_DECK_RAD;
  angled.receiveShadow = true;
  group.add(angled);

  // Deck-edge coaming strip around the perimeter.
  const edgeMat = structureMat;
  for (const [x, w] of [
    [17.4, 0.9],
    [-17.4, 0.9],
  ] as Array<[number, number]>) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, DECK_LENGTH), edgeMat);
    edge.position.set(x, DECK_Y + 0.3, 0);
    group.add(edge);
  }

  // Port sponson supporting the overhanging angled deck.
  const sponson = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 120), edgeMat);
  sponson.position.set(-19, DECK_Y - 2.6, 40);
  sponson.rotation.y = -ANGLED_DECK_RAD;
  group.add(sponson);

  // Aircraft-elevator outlines (recessed panels on the deck edge).
  for (const z of [-40, 46]) {
    const elevator = new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, 20), edgeMat);
    elevator.position.set(19.5, DECK_Y + 0.05, z);
    group.add(elevator);
    const outline = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.12, 20.6), deckMat);
    outline.position.set(19.5, DECK_Y + 0.2, z);
    group.add(outline);
  }

  return group;
}

/** Island superstructure: tiered blocks, bridge windows, mast and antennae. */
function buildIsland(mat: THREE.Material): { group: THREE.Group; radarDish: THREE.Object3D } {
  const group = new THREE.Group();
  const baseX = 12.5;

  const lower = new THREE.Mesh(new THREE.BoxGeometry(9.5, 11, 36), mat);
  lower.position.set(baseX, DECK_Y + 5.5, -8);
  lower.castShadow = true;
  group.add(lower);

  const mid = new THREE.Mesh(new THREE.BoxGeometry(8.6, 6.5, 26), mat);
  mid.position.set(baseX, DECK_Y + 14.2, -12);
  mid.castShadow = true;
  group.add(mid);

  // Bridge with a dark glazed band.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(10.4, 3.4, 11), mat);
  bridge.position.set(baseX, DECK_Y + 19.2, -19);
  bridge.castShadow = true;
  group.add(bridge);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x121c22,
    roughness: 0.18,
    metalness: 0.72,
    emissive: 0x0a1a14,
    emissiveIntensity: 0.35,
  });
  const windows = new THREE.Mesh(new THREE.BoxGeometry(10.7, 1.7, 11.3), glassMat);
  windows.position.set(baseX, DECK_Y + 19.6, -19);
  group.add(windows);

  // Flight-deck control (pri-fly) glazing facing aft.
  const priFly = new THREE.Mesh(new THREE.BoxGeometry(9.2, 1.5, 6), glassMat);
  priFly.position.set(baseX, DECK_Y + 15.5, -3);
  group.add(priFly);

  // Lattice mast.
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.7, metalness: 0.4 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 15, 6), mastMat);
  mast.position.set(baseX - 1, DECK_Y + 28, -6);
  group.add(mast);
  for (let y = 0; y < 4; y++) {
    const spar = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.16, 0.16), mastMat);
    spar.position.set(baseX - 1, DECK_Y + 23 + y * 3.4, -6);
    group.add(spar);
    const spar2 = spar.clone();
    spar2.rotation.y = Math.PI / 2;
    group.add(spar2);
  }

  // Rotating air-search radar array.
  const radarDish = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 2.4, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x8d9284, roughness: 0.75, metalness: 0.3 }),
  );
  radarDish.add(panel);
  const truss = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 0.9), mastMat);
  truss.position.y = -1.4;
  radarDish.add(truss);
  radarDish.position.set(
    CARRIER_ATTACHMENTS.carrierRadar.x,
    CARRIER_ATTACHMENTS.carrierRadar.y,
    CARRIER_ATTACHMENTS.carrierRadar.z,
  );
  group.add(radarDish);

  // Secondary whip antennae.
  for (const [dx, dz, h] of [
    [2.5, -26, 7],
    [-2.2, 4, 5.5],
    [3.4, -14, 6],
  ] as Array<[number, number, number]>) {
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, h, 4), mastMat);
    whip.position.set(baseX + dx, DECK_Y + 11 + h / 2, dz);
    group.add(whip);
  }

  // Basic defensive fixtures (close-in weapon mounts) on sponsons.
  const cwsMat = new THREE.MeshStandardMaterial({ color: 0x6f7377, roughness: 0.8, metalness: 0.3 });
  for (const [x, z] of [
    [19.5, -70],
    [-19.5, 92],
    [19.5, 96],
  ] as Array<[number, number]>) {
    const mount = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 8), cwsMat);
    mount.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6 }));
    dome.position.y = 1.1;
    mount.add(dome);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 6), cwsMat);
    barrel.rotation.x = Math.PI / 2.6;
    barrel.position.set(0, 0.9, -0.9);
    mount.add(barrel);
    mount.position.set(x, DECK_Y + 0.4, z);
    group.add(mount);
  }

  return { group, radarDish };
}

/** Deck and approach lighting. Emissive meshes — cheap, and they read well against the grey deck. */
function buildDeckLights(): { group: THREE.Group; lights: THREE.Object3D[] } {
  const group = new THREE.Group();
  const lights: THREE.Object3D[] = [];

  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x4dff7a });
  const amberMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  const lightGeo = new THREE.SphereGeometry(0.17, 6, 5);

  // Deck-edge lights down both sides.
  for (const side of [-1, 1]) {
    for (let z = -104; z <= 104; z += 12) {
      const light = new THREE.Mesh(lightGeo, side < 0 ? redMat : greenMat);
      light.position.set(side * 17.2, DECK_Y + 0.7, z);
      group.add(light);
      lights.push(light);
    }
  }

  // Angled-deck centreline approach lights.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const z = 40 + t * 130;
    const x = -11.5 - Math.sin(ANGLED_DECK_RAD) * (z - 34) * 0.0 + (t - 0.5) * 2;
    const light = new THREE.Mesh(lightGeo, whiteMat);
    light.position.set(x + 9.5, DECK_Y + 0.65, z);
    group.add(light);
    lights.push(light);
  }

  // Optical landing system ("meatball") on the port side — amber datum lights.
  const olsGroup = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.3), i === 2 ? amberMat : whiteMat);
    cell.position.set(0, i * 0.62, 0);
    olsGroup.add(cell);
  }
  olsGroup.position.set(-19.5, DECK_Y + 1.6, 62);
  group.add(olsGroup);
  lights.push(olsGroup);

  return { group, lights };
}

/** Layered translucent wake trailing the stern. */
function buildWake(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(30, 220, 1, 24);
  // Taper the wake outward as it trails aft.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // along the plane's length before rotation
    const t = (y + 110) / 220; // 0 at far end, 1 at ship
    pos.setX(i, pos.getX(i) * (0.35 + (1 - t) * 1.5));
  }
  pos.needsUpdate = true;

  const mat = new THREE.MeshBasicMaterial({
    color: 0xdff0f5,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.35, 128);
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * Builds the CVN Resolute. All geometry is original and procedural; the deck and hull surfaces
 * use runtime-generated canvas textures.
 */
export function buildCarrierModel(settings: GraphicsSettings): CarrierModelResult {
  const group = new THREE.Group();
  group.name = 'CVN Resolute';

  const hullMat = hullMaterial();
  const structureMat = new THREE.MeshStandardMaterial({ color: 0x4e5459, roughness: 0.85, metalness: 0.18 });

  const deckTex = getCarrierDeckTexture(settings.anisotropy);
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.04,
  });

  group.add(buildHull(hullMat));
  group.add(buildDeck(deckMat, structureMat));

  const island = buildIsland(structureMat);
  group.add(island.group);

  const lights = buildDeckLights();
  group.add(lights.group);

  const wake = buildWake();
  group.add(wake);

  // Resolve named attachment points as real Object3Ds parented to the carrier.
  const attachments = {} as Record<CarrierAttachmentName, THREE.Object3D>;
  for (const [name, local] of Object.entries(CARRIER_ATTACHMENTS) as Array<
    [CarrierAttachmentName, THREE.Vector3]
  >) {
    const marker = new THREE.Object3D();
    marker.name = `attach:${name}`;
    marker.position.copy(local);
    group.add(marker);
    attachments[name] = marker;
  }

  // Shadow policy: the deck receives, the superstructure casts. Nothing else on the ship needs it.
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.frustumCulled = true;
    }
  });

  return { group, attachments, radarDish: island.radarDish, wake, deckLights: lights.lights };
}
