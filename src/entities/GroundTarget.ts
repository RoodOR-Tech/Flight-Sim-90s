import * as THREE from 'three';
import { buildRadarSite } from '../game/AssetFactory';
import { Targetable } from '../game/Types';

const MAX_HEALTH = 140;

/** The hostile coastal radar installation - the mission's ground-strike objective. */
export class GroundTarget implements Targetable {
  id = 'radar-site';
  team: 'enemy' = 'enemy';
  kind: 'ground' = 'ground';
  label = 'Coastal Radar';

  group: THREE.Group;
  health = MAX_HEALTH;
  destroyed = false;
  active = false; // objective isn't "live" until the air threats are cleared

  private velocityZero = new THREE.Vector3();
  private dishArm: THREE.Object3D | null;

  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    this.group = buildRadarSite();
    this.group.position.copy(position);
    scene.add(this.group);
    this.dishArm = (this.group as any).userData.dishArm ?? null;
  }

  update(dt: number, elapsed: number) {
    if (this.dishArm && !this.destroyed) {
      this.dishArm.rotation.y = elapsed * 0.9;
    }
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
  }
  getVelocity(): THREE.Vector3 {
    return this.velocityZero;
  }
  isAlive(): boolean {
    return !this.destroyed;
  }
  getCollisionRadius(): number {
    return 8;
  }

  applyDamage(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.destroyed = true;
    }
  }

  healthFraction(): number {
    return THREE.MathUtils.clamp(this.health / MAX_HEALTH, 0, 1);
  }
}
