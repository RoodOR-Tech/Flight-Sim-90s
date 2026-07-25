import * as THREE from 'three';
import { buildCarrier, buildWakeSprite } from '../game/AssetFactory';

const SPEED = 4; // m/s, slow straight-line transit

/** Local-space reference points on the carrier model, matching the geometry built in AssetFactory. */
export const CARRIER_LOCAL = {
  deckY: 1.5,
  catapultStart: new THREE.Vector3(-9, 1.5, -95),
  catapultEnd: new THREE.Vector3(-9, 1.5, -45),
  arrestingZoneStart: new THREE.Vector3(2, 1.5, 50),
  arrestingZoneEnd: new THREE.Vector3(2, 1.5, 98),
  deckCenterline: 2,
  deckHalfWidth: 15,
};

export class Carrier {
  group: THREE.Group;
  headingDeg: number;
  private wake: THREE.Mesh;
  private dish: THREE.Object3D | null = null;

  constructor(scene: THREE.Scene, position: THREE.Vector3, headingDeg: number) {
    this.group = buildCarrier();
    this.group.position.copy(position);
    this.headingDeg = headingDeg;
    this.group.rotation.y = -THREE.MathUtils.degToRad(headingDeg);
    scene.add(this.group);

    this.wake = buildWakeSprite();
    this.wake.position.set(0, -3.4, 130);
    this.group.add(this.wake);

    this.dish = this.group.getObjectByName('carrierRadarDish') ?? null;
  }

  update(dt: number, elapsed: number) {
    const headingRad = -THREE.MathUtils.degToRad(this.headingDeg);
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.group.position.addScaledVector(forward, SPEED * dt);
    if (this.dish) this.dish.rotation.y = elapsed * 0.6;
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
  }

  localToWorld(local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyMatrix4(this.group.matrixWorld);
  }

  getForward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
  }

  getDeckLandingCenterline(out0 = new THREE.Vector3(), out1 = new THREE.Vector3()) {
    out0.copy(this.localToWorld(CARRIER_LOCAL.arrestingZoneStart));
    out1.copy(this.localToWorld(CARRIER_LOCAL.arrestingZoneEnd));
    return { start: out0, end: out1 };
  }

  getCatapultWorld(out0 = new THREE.Vector3(), out1 = new THREE.Vector3()) {
    out0.copy(this.localToWorld(CARRIER_LOCAL.catapultStart));
    out1.copy(this.localToWorld(CARRIER_LOCAL.catapultEnd));
    return { start: out0, end: out1 };
  }
}
