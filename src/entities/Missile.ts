import * as THREE from 'three';
import { buildMissileVisual } from '../game/AssetFactory';
import { Targetable } from '../game/Types';

const MAX_SPEED = 340;
const LAUNCH_SPEED = 130;
const ACCEL = 220;
const TURN_RATE = 1.9; // rad/s - finite turning ability, can be out-turned by hard maneuvers
const MAX_LIFETIME = 9;
const PROXIMITY_RADIUS = 16;
const SMOKE_INTERVAL = 0.05;

export type MissileOwner = 'player' | 'enemy';

export class Missile {
  position = new THREE.Vector3();
  velocity: THREE.Vector3;
  mesh: THREE.Group;
  target: Targetable | null;
  owner: MissileOwner;
  life = 0;
  alive = true;
  exploded = false;
  hitTarget = false;
  private smokeTimer = 0;
  onSmoke?: (pos: THREE.Vector3) => void;

  constructor(scene: THREE.Scene, launchPos: THREE.Vector3, launchDir: THREE.Vector3, target: Targetable | null, owner: MissileOwner) {
    this.position.copy(launchPos);
    this.velocity = launchDir.clone().normalize().multiplyScalar(LAUNCH_SPEED);
    this.target = target;
    this.owner = owner;
    this.mesh = buildMissileVisual();
    this.mesh.position.copy(launchPos);
    scene.add(this.mesh);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.life += dt;

    let desiredDir = this.velocity.clone().normalize();
    if (this.target && this.target.isAlive()) {
      const toTarget = this.target.getPosition().clone().sub(this.position);
      if (toTarget.lengthSq() > 0.01) desiredDir = toTarget.normalize();
    }

    const currentDir = this.velocity.clone().normalize();
    const dot = THREE.MathUtils.clamp(currentDir.dot(desiredDir), -1, 1);
    const angle = Math.acos(dot);
    const maxStep = TURN_RATE * dt;
    let newDir: THREE.Vector3;
    if (angle <= maxStep || angle < 1e-5) {
      newDir = desiredDir;
    } else {
      newDir = currentDir.clone().lerp(desiredDir, maxStep / angle).normalize();
    }

    const speed = THREE.MathUtils.clamp(this.velocity.length() + ACCEL * dt, LAUNCH_SPEED, MAX_SPEED);
    this.velocity.copy(newDir.multiplyScalar(speed));
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), newDir);

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = SMOKE_INTERVAL;
      this.onSmoke?.(this.position.clone());
    }

    if (this.target && this.target.isAlive()) {
      const dist = this.position.distanceTo(this.target.getPosition());
      if (dist < PROXIMITY_RADIUS) {
        this.detonate(true);
        return;
      }
    }

    if (this.position.y < 1) {
      this.detonate(false);
      return;
    }

    if (this.life > MAX_LIFETIME) {
      this.detonate(false);
    }
  }

  detonate(hit: boolean) {
    if (this.exploded) return;
    this.exploded = true;
    this.hitTarget = hit;
    this.alive = false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
  }
}
