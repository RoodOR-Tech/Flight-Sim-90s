import * as THREE from 'three';
import { Targetable } from '../game/Types';
import { buildRadarSiteModel, RadarSiteModelResult } from '../rendering/models/RadarSiteModel';
import { GraphicsSettings } from '../rendering/GraphicsPresets';

const MAX_HEALTH = 140;

/**
 * The hostile coastal radar installation — the mission's ground-strike objective.
 *
 * Follows the same root/visual split as the aircraft: `root` is the gameplay transform, the
 * detailed model is a child, and collision uses a simple sphere rather than the visual mesh.
 */
export class GroundTarget implements Targetable {
  id = 'radar-site';
  team: 'enemy' = 'enemy';
  kind: 'ground' = 'ground';
  label = 'Coastal Radar';

  root = new THREE.Group();
  model: RadarSiteModelResult;
  health = MAX_HEALTH;
  destroyed = false;
  /** Objective is not live until the air threats are cleared. */
  active = false;

  /** Collision sphere centred slightly above the pad, covering the dish assembly. */
  collisionCenterOffset = new THREE.Vector3(0, 5, 0);

  private velocityZero = new THREE.Vector3();
  private smokeTimer = 0;
  private collisionCenter = new THREE.Vector3();

  constructor(scene: THREE.Scene, position: THREE.Vector3, settings: GraphicsSettings) {
    this.model = buildRadarSiteModel(settings);
    this.root.name = 'radar-site-root';
    this.root.add(this.model.group);
    this.root.position.copy(position);
    scene.add(this.root);
  }

  /** Re-seats the installation at a new position (used when terrain height is resolved). */
  setPosition(position: THREE.Vector3) {
    this.root.position.copy(position);
  }

  update(dt: number, elapsed: number) {
    if (!this.destroyed) {
      this.model.dishArm.rotation.y = elapsed * 0.9;
    }
    if (this.smokeTimer > 0) this.smokeTimer -= dt;
  }

  /** True when the burning wreck should emit a smoke puff this frame. */
  consumeSmokeTick(): boolean {
    if (!this.destroyed) return false;
    if (this.smokeTimer > 0) return false;
    this.smokeTimer = 0.22;
    return true;
  }

  /**
   * Targeting/collision centre — the dish assembly, not the concrete pad.
   * Radar lock, missile guidance and cannon hits all use this, so rounds aimed at the visible
   * structure register instead of passing over a sphere sunk into the ground.
   */
  getPosition(): THREE.Vector3 {
    return this.collisionCenter.copy(this.root.position).add(this.collisionCenterOffset);
  }

  /** The installation's ground position (pad centre), for map display and placement. */
  getGroundPosition(): THREE.Vector3 {
    return this.root.position;
  }

  getVelocity(): THREE.Vector3 {
    return this.velocityZero;
  }

  isAlive(): boolean {
    return !this.destroyed;
  }

  getCollisionRadius(): number {
    return 9;
  }

  applyDamage(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.destroyed = true;
      this.onDestroyed();
    }
  }

  private onDestroyed() {
    // Collapse the antenna and reveal the wreckage/scorch.
    this.model.dishArm.rotation.z = THREE.MathUtils.degToRad(58);
    this.model.dishArm.position.y = 2.6;
    this.model.wreckage.visible = true;
  }

  healthFraction(): number {
    return THREE.MathUtils.clamp(this.health / MAX_HEALTH, 0, 1);
  }

  getDamageWorldPositions(): THREE.Vector3[] {
    return this.model.damagePoints.map((p) => p.getWorldPosition(new THREE.Vector3()));
  }

  resetForMission() {
    this.health = MAX_HEALTH;
    this.destroyed = false;
    this.active = false;
    this.smokeTimer = 0;
    this.model.wreckage.visible = false;
    this.model.dishArm.rotation.set(0, 0, 0);
    this.model.dishArm.position.y = 6;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    this.model.dispose();
  }
}
