import * as THREE from 'three';
import {
  buildCarrierModel,
  CARRIER_ATTACHMENTS,
  CarrierAttachmentName,
  DECK_Y,
  ANGLED_DECK_RAD,
} from '../rendering/models/CarrierModel';
import { GraphicsSettings } from '../rendering/GraphicsPresets';

const SPEED = 4; // m/s, slow straight-line transit

/**
 * Local-space reference points on the carrier.
 *
 * Preserved for backwards compatibility with the collision and landing code. These are now
 * derived from the model's named attachment points, so the visual model and the gameplay
 * reference frame can never drift apart.
 */
export const CARRIER_LOCAL = {
  deckY: DECK_Y,
  catapultStart: CARRIER_ATTACHMENTS.catapultStart.clone(),
  catapultEnd: CARRIER_ATTACHMENTS.catapultEnd.clone(),
  arrestingZoneStart: CARRIER_ATTACHMENTS.landingZoneStart.clone(),
  arrestingZoneEnd: CARRIER_ATTACHMENTS.landingZoneEnd.clone(),
  deckCenterline: CARRIER_ATTACHMENTS.landingZoneCenter.x,
  deckHalfWidth: 15,
  angledDeckRad: ANGLED_DECK_RAD,
};

export class Carrier {
  group: THREE.Group;
  headingDeg: number;
  attachments: Record<CarrierAttachmentName, THREE.Object3D>;

  private wake: THREE.Mesh;
  private radarDish: THREE.Object3D;
  private deckLights: THREE.Object3D[];

  constructor(scene: THREE.Scene, position: THREE.Vector3, headingDeg: number, settings: GraphicsSettings) {
    const model = buildCarrierModel(settings);
    this.group = model.group;
    this.attachments = model.attachments;
    this.wake = model.wake;
    this.radarDish = model.radarDish;
    this.deckLights = model.deckLights;

    this.group.position.copy(position);
    this.headingDeg = headingDeg;
    this.group.rotation.y = -THREE.MathUtils.degToRad(headingDeg);
    this.group.updateMatrixWorld(true);
    scene.add(this.group);

    this.applyQuality(settings);
  }

  applyQuality(settings: GraphicsSettings) {
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Only the tall superstructure casts; the deck receives. Keeps the shadow pass cheap.
      const isTall = o.position.y > DECK_Y + 3;
      o.castShadow = settings.shadowsEnabled && isTall;
    });
  }

  resetPosition(position: THREE.Vector3, headingDeg: number) {
    this.group.position.copy(position);
    this.headingDeg = headingDeg;
    this.group.rotation.y = -THREE.MathUtils.degToRad(headingDeg);
    this.group.updateMatrixWorld(true);
  }

  update(dt: number, elapsed: number) {
    const headingRad = -THREE.MathUtils.degToRad(this.headingDeg);
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.group.position.addScaledVector(forward, SPEED * dt);
    this.radarDish.rotation.y = elapsed * 0.6;

    // Subtle wake shimmer.
    const mat = this.wake.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.28 + Math.sin(elapsed * 1.7) * 0.04;

    // Blink the optical landing system datum gently so the deck reads as active.
    const blink = (Math.sin(elapsed * 2.4) + 1) * 0.5;
    const ols = this.deckLights[this.deckLights.length - 1];
    if (ols) ols.scale.setScalar(0.9 + blink * 0.2);
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
  }

  /** Resolves a named attachment point to world space. */
  getAttachmentWorld(name: CarrierAttachmentName, out = new THREE.Vector3()): THREE.Vector3 {
    this.attachments[name].getWorldPosition(out);
    return out;
  }

  localToWorld(local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyMatrix4(this.group.matrixWorld);
  }

  getForward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
  }

  getDeckLandingCenterline(out0 = new THREE.Vector3(), out1 = new THREE.Vector3()) {
    this.getAttachmentWorld('landingZoneStart', out0);
    this.getAttachmentWorld('landingZoneEnd', out1);
    return { start: out0, end: out1 };
  }

  getCatapultWorld(out0 = new THREE.Vector3(), out1 = new THREE.Vector3()) {
    this.getAttachmentWorld('catapultStart', out0);
    this.getAttachmentWorld('catapultEnd', out1);
    return { start: out0, end: out1 };
  }
}
