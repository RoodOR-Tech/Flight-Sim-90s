import * as THREE from 'three';
import { AircraftController } from '../flight/AircraftController';
import { FlightModel, DEFAULT_FLIGHT_CONFIG, FlightControls } from '../flight/FlightModel';
import { AircraftVisual, buildAircraft } from '../game/AssetFactory';
import { Targetable } from '../game/Types';
import { DifficultySettings } from '../game/Constants';

export type EnemyState =
  | 'patrol'
  | 'intercept'
  | 'pursue'
  | 'attack'
  | 'evade'
  | 'disengage'
  | 'destroyed';

let enemyCounter = 0;

const DETECTION_RANGE = 2600;
const ATTACK_RANGE = 650;
const GUN_RANGE = 420;
const MISSILE_MIN_RANGE = 350;

export class EnemyAircraft implements Targetable {
  id: string;
  team: 'enemy' = 'enemy';
  kind: 'aircraft' = 'aircraft';
  label = 'Kestrel-9';

  controller: AircraftController;
  visual: AircraftVisual;
  state: EnemyState = 'patrol';

  private stateTimer = 0;
  private patrolCenter: THREE.Vector3;
  private patrolAngle: number;
  private reactionTimer = 0;
  private cannonCooldown = 0;
  private missileCooldown = 3;
  private missilesLeft = 2;
  private evadeDir = 1;
  private beingTargetedByMissile = false;

  cannonFireRequested = false;
  missileFireRequested = false;

  constructor(scene: THREE.Scene, spawnPos: THREE.Vector3, private difficulty: DifficultySettings) {
    enemyCounter += 1;
    this.id = `enemy-${enemyCounter}`;
    this.visual = buildAircraft(true);
    scene.add(this.visual.group);
    const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG, maxHealth: difficulty.enemyHealth });
    fm.position.copy(spawnPos);
    fm.throttle = 0.55;
    fm.velocity.set(0, 0, -90);
    this.controller = new AircraftController(this.visual.group, fm);
    this.patrolCenter = spawnPos.clone();
    this.patrolAngle = Math.random() * Math.PI * 2;
  }

  getPosition(): THREE.Vector3 {
    return this.controller.flightModel.position;
  }
  getVelocity(): THREE.Vector3 {
    return this.controller.flightModel.velocity;
  }
  isAlive(): boolean {
    return this.controller.alive;
  }
  getCollisionRadius(): number {
    return 3.2;
  }
  applyDamage(amount: number): void {
    this.controller.applyDamage(amount);
  }

  notifyMissileThreat() {
    this.beingTargetedByMissile = true;
  }

  private setState(s: EnemyState) {
    if (this.state !== s) {
      this.state = s;
      this.stateTimer = 0;
    }
  }

  /** Advances the AI finite-state-machine and steps the underlying flight model. */
  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean, otherEnemyPos: THREE.Vector3 | null) {
    this.cannonFireRequested = false;
    this.missileFireRequested = false;
    if (!this.controller.alive) {
      this.setState('destroyed');
      return;
    }

    this.stateTimer += dt;
    if (this.cannonCooldown > 0) this.cannonCooldown -= dt;
    if (this.missileCooldown > 0) this.missileCooldown -= dt;
    if (this.reactionTimer > 0) this.reactionTimer -= dt;

    const pos = this.controller.flightModel.position;
    const distToPlayer = playerAlive ? pos.distanceTo(playerPos) : Infinity;

    switch (this.state) {
      case 'patrol':
        if (playerAlive && distToPlayer < DETECTION_RANGE && this.reactionTimer <= 0) {
          this.reactionTimer = this.difficulty.enemyReactionTime;
          this.setState('intercept');
        }
        break;
      case 'intercept':
        if (!playerAlive) this.setState('patrol');
        else if (distToPlayer < ATTACK_RANGE) this.setState('attack');
        break;
      case 'pursue':
        if (!playerAlive) this.setState('disengage');
        else if (distToPlayer < ATTACK_RANGE) this.setState('attack');
        else if (distToPlayer > DETECTION_RANGE * 1.4) this.setState('disengage');
        break;
      case 'attack':
        if (!playerAlive) this.setState('disengage');
        else if (this.beingTargetedByMissile) this.setState('evade');
        else if (distToPlayer > ATTACK_RANGE * 1.3) this.setState('pursue');
        break;
      case 'evade':
        if (this.stateTimer > 3.5) {
          this.beingTargetedByMissile = false;
          this.setState(playerAlive ? 'pursue' : 'disengage');
        }
        break;
      case 'disengage':
        if (this.stateTimer > 4 && playerAlive && distToPlayer < DETECTION_RANGE) {
          this.setState('intercept');
        } else if (this.stateTimer > 6) {
          this.setState('patrol');
        }
        break;
      case 'destroyed':
        break;
    }

    const controls = this.computeControls(dt, playerPos, playerAlive, otherEnemyPos, distToPlayer);
    this.controller.step(dt, controls);

    const fm = this.controller.flightModel;
    const glowOn = fm.afterburnerActive ? 0.9 : fm.throttle * 0.4;
    (this.visual.leftEngineGlow.material as THREE.MeshBasicMaterial).opacity = glowOn;
    (this.visual.rightEngineGlow.material as THREE.MeshBasicMaterial).opacity = glowOn;
    this.visual.gearGroup.visible = false;
  }

  private computeControls(
    dt: number,
    playerPos: THREE.Vector3,
    playerAlive: boolean,
    otherEnemyPos: THREE.Vector3 | null,
    distToPlayer: number,
  ): FlightControls {
    const fm = this.controller.flightModel;
    const pos = fm.position;
    let targetPoint: THREE.Vector3;
    let desiredSpeed = 110;
    let afterburner = false;

    if (this.state === 'patrol') {
      this.patrolAngle += dt * 0.08;
      targetPoint = this.patrolCenter
        .clone()
        .add(new THREE.Vector3(Math.cos(this.patrolAngle) * 500, 0, Math.sin(this.patrolAngle) * 500));
      targetPoint.y = this.patrolCenter.y;
      desiredSpeed = 95;
    } else if (this.state === 'evade') {
      const right = fm.getRight();
      targetPoint = pos
        .clone()
        .add(fm.getForward().multiplyScalar(200))
        .add(right.multiplyScalar(this.evadeDir * 220))
        .add(new THREE.Vector3(0, 60, 0));
      desiredSpeed = 260;
      afterburner = true;
      if (this.stateTimer < dt * 1.5) this.evadeDir = Math.random() > 0.5 ? 1 : -1;
    } else if (this.state === 'disengage') {
      targetPoint = this.patrolCenter.clone().add(new THREE.Vector3(0, 40, 0));
      desiredSpeed = 150;
    } else if (this.state === 'attack' && playerAlive) {
      // Aim slightly ahead of the player and try to settle behind/below their tail.
      const behind = playerPos
        .clone()
        .sub(pos)
        .normalize()
        .multiplyScalar(-1);
      targetPoint = playerPos.clone().add(behind.multiplyScalar(-140));
      desiredSpeed = 150 * this.difficulty.enemyAggression;
      afterburner = distToPlayer > ATTACK_RANGE * 0.9;

      if (this.cannonCooldown <= 0 && distToPlayer < GUN_RANGE) {
        const toPlayer = playerPos.clone().sub(pos).normalize();
        const boresight = toPlayer.dot(fm.getForward());
        if (boresight > 0.94 && Math.random() < this.difficulty.enemyAccuracy + 0.15) {
          this.cannonFireRequested = true;
          this.cannonCooldown = 0.7 + Math.random() * 0.6;
        }
      }
      if (
        this.missileCooldown <= 0 &&
        this.missilesLeft > 0 &&
        distToPlayer > MISSILE_MIN_RANGE &&
        distToPlayer < ATTACK_RANGE * 1.4 &&
        Math.random() < this.difficulty.enemyAccuracy * 0.5
      ) {
        this.missileFireRequested = true;
        this.missilesLeft -= 1;
        this.missileCooldown = 6 + Math.random() * 3;
      }
    } else if (playerAlive) {
      targetPoint = playerPos.clone();
      desiredSpeed = 220;
      afterburner = distToPlayer > 1200;
    } else {
      targetPoint = this.patrolCenter.clone();
    }

    // Separation from the other enemy to avoid mid-air collisions/bunching.
    if (otherEnemyPos) {
      const sepDist = pos.distanceTo(otherEnemyPos);
      if (sepDist < 90) {
        const away = pos.clone().sub(otherEnemyPos).normalize();
        targetPoint = targetPoint.clone().add(away.multiplyScalar(150));
      }
    }

    // Avoid the ocean.
    if (pos.y < 130) {
      targetPoint = targetPoint.clone();
      targetPoint.y = Math.max(targetPoint.y, 250);
    }

    const toTarget = targetPoint.clone().sub(pos).normalize();
    const invQuat = fm.quaternion.clone().invert();
    const localDir = toTarget.clone().applyQuaternion(invQuat);

    const aggro = this.difficulty.enemyAggression;
    const rollInput = THREE.MathUtils.clamp(localDir.x * 2.2 * aggro, -1, 1);
    let pitchInput = THREE.MathUtils.clamp(localDir.y * 2.4 * aggro, -1, 1);
    pitchInput += Math.abs(rollInput) * 0.25;
    pitchInput = THREE.MathUtils.clamp(pitchInput, -1, 1);
    const yawInput = THREE.MathUtils.clamp(localDir.x * 0.6, -1, 1);

    const speed = fm.getSpeed();
    const throttleInput = speed < desiredSpeed ? 1 : speed > desiredSpeed + 20 ? -1 : 0;

    return {
      pitch: pitchInput,
      roll: rollInput,
      yaw: yawInput,
      throttleInput,
      afterburner,
    };
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.visual.group);
  }
}
