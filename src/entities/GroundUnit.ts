import * as THREE from 'three';
import { Targetable } from '../game/Types';
import { DifficultySettings } from '../game/Constants';
import { GraphicsSettings } from '../rendering/GraphicsPresets';
import { buildGroundUnitModel, GroundUnitKind, GroundUnitModelResult } from '../rendering/models/GroundUnitModel';

export type { GroundUnitKind };

const TANK_HEALTH = 50;
const FLAK_HEALTH = 30;
const TANK_SPEED = 5; // m/s along the route

/** Cannon rounds fly at this speed (see Projectile.ts); used to lead the target. */
const ROUND_SPEED = 780;
export const FLAK_RANGE = 900;
const FLAK_BURST_ROUNDS = 6;
const FLAK_BURST_INTERVAL = 0.12;

export interface GroundUnitOptions {
  kind: GroundUnitKind;
  id: string;
  /** Start position (X/Z; Y is taken from the terrain). */
  start: THREE.Vector3;
  /** Tanks drive toward this point and halt there. Omit for a stationary vehicle. */
  destination?: THREE.Vector3;
  /** How far short of the destination this vehicle halts (keeps the column spaced). */
  haltShort?: number;
}

/**
 * A hostile ground vehicle for the strike mission: a tank that drives along a route, or a
 * stationary flak carrier that tracks the player and fires leading bursts when in range.
 *
 * Like the other entities, `root` is the gameplay transform, the model hangs beneath it, and
 * collision is a simple sphere. Height always comes from the terrain query, so vehicles sit on
 * exactly the ground the player can see and crash into.
 */
export class GroundUnit implements Targetable {
  id: string;
  team: 'enemy' = 'enemy';
  kind: 'ground' = 'ground';
  label: string;
  unitKind: GroundUnitKind;

  root = new THREE.Group();
  model: GroundUnitModelResult;
  health: number;
  destroyed = false;

  /** Set for one update when the flak gun wants a round fired along `fireDirection`. */
  fireRequested = false;
  fireOrigin = new THREE.Vector3();
  fireDirection = new THREE.Vector3();

  private maxHealth: number;
  private travel = new THREE.Vector3();
  private routeLength = 0;
  private travelled = 0;
  private start = new THREE.Vector3();
  private center = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private smokeTimer = 0;
  private burstCooldown: number;
  private burstRoundsLeft = 0;
  private burstTimer = 0;
  private aim = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    options: GroundUnitOptions,
    private heightAt: (x: number, z: number) => number,
    private difficulty: DifficultySettings,
    settings: GraphicsSettings,
  ) {
    this.id = options.id;
    this.unitKind = options.kind;
    this.label = options.kind === 'tank' ? 'Bulwark Tank' : 'Flak Vehicle';
    this.maxHealth = options.kind === 'tank' ? TANK_HEALTH : FLAK_HEALTH;
    this.health = this.maxHealth;
    this.model = buildGroundUnitModel(options.kind, settings);
    this.root.name = this.id;
    this.root.add(this.model.group);
    scene.add(this.root);

    this.start.set(options.start.x, 0, options.start.z);
    if (options.destination) {
      this.travel.set(options.destination.x - options.start.x, 0, options.destination.z - options.start.z);
      this.routeLength = Math.max(0, this.travel.length() - (options.haltShort ?? 0));
      this.travel.normalize();
      // Model forward is -Z.
      this.root.rotation.y = Math.atan2(-this.travel.x, -this.travel.z);
    }
    // Stagger the first bursts so two flak vehicles do not fire in unison.
    this.burstCooldown = 1 + Math.random() * 1.5;
    this.place();
  }

  private place() {
    const x = this.start.x + this.travel.x * this.travelled;
    const z = this.start.z + this.travel.z * this.travelled;
    this.root.position.set(x, this.heightAt(x, z), z);
  }

  /** Targeting/collision centre: mid-hull, not the ground contact point. */
  getPosition(): THREE.Vector3 {
    return this.center.copy(this.root.position).setY(this.root.position.y + 1.3);
  }

  getVelocity(): THREE.Vector3 {
    return this.velocity;
  }

  isAlive(): boolean {
    return !this.destroyed;
  }

  getCollisionRadius(): number {
    return 4.2;
  }

  isMoving(): boolean {
    return !this.destroyed && this.travelled < this.routeLength;
  }

  applyDamage(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.destroyed = true;
      this.velocity.set(0, 0, 0);
      this.model.intact.visible = false;
      this.model.wreckage.visible = true;
    }
  }

  healthFraction(): number {
    return this.health / this.maxHealth;
  }

  update(dt: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, playerAlive: boolean) {
    this.fireRequested = false;
    if (this.smokeTimer > 0) this.smokeTimer -= dt;
    if (this.destroyed) return;

    if (this.travelled < this.routeLength) {
      this.travelled = Math.min(this.routeLength, this.travelled + TANK_SPEED * dt);
      this.velocity.copy(this.travel).multiplyScalar(this.travelled < this.routeLength ? TANK_SPEED : 0);
      this.place();
    }

    if (this.unitKind !== 'flak' || !playerAlive) return;

    const origin = this.fireOrigin.copy(this.root.position).setY(this.root.position.y + 2.6);
    const distance = origin.distanceTo(playerPos);
    // Lead the aircraft by the round's time of flight.
    this.aim.copy(playerPos).addScaledVector(playerVel, distance / ROUND_SPEED).sub(origin);
    const aimDistance = this.aim.length();
    if (aimDistance > 1) {
      this.aim.divideScalar(aimDistance);
      // Slew the turret (yaw, relative to the hull) and elevate the barrels.
      this.model.turret.rotation.y = Math.atan2(-this.aim.x, -this.aim.z) - this.root.rotation.y;
      this.model.barrel.rotation.x = Math.asin(THREE.MathUtils.clamp(this.aim.y, -0.1, 1));
    }

    if (distance > FLAK_RANGE) {
      this.burstRoundsLeft = 0;
      return;
    }

    if (this.burstRoundsLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = FLAK_BURST_INTERVAL;
        this.burstRoundsLeft -= 1;
        // Aiming error shrinks with difficulty; even on Hard the gun is not a laser.
        const error = (1 - this.difficulty.enemyAccuracy) * 0.02;
        this.fireDirection.copy(this.aim);
        this.fireDirection.x += (Math.random() - 0.5) * error;
        this.fireDirection.y += (Math.random() - 0.5) * error;
        this.fireDirection.z += (Math.random() - 0.5) * error;
        this.fireDirection.normalize();
        this.fireRequested = true;
      }
      return;
    }

    this.burstCooldown -= dt;
    if (this.burstCooldown <= 0) {
      this.burstRoundsLeft = FLAK_BURST_ROUNDS;
      this.burstTimer = 0;
      this.burstCooldown = 1.4 + this.difficulty.enemyReactionTime * 1.6 + Math.random() * 0.8;
    }
  }

  /** True when the burning wreck should emit a smoke puff this frame. */
  consumeSmokeTick(): boolean {
    if (!this.destroyed || this.smokeTimer > 0) return false;
    this.smokeTimer = 0.3;
    return true;
  }

  getSmokeWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.smokePoint.getWorldPosition(out);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
  }
}
