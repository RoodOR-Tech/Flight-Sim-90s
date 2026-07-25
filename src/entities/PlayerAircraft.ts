import * as THREE from 'three';
import { AircraftController } from '../flight/AircraftController';
import { FlightModel, DEFAULT_FLIGHT_CONFIG } from '../flight/FlightModel';
import { AircraftVisual, buildAircraft } from '../game/AssetFactory';
import { Targetable } from '../game/Types';

export type WeaponType = 'cannon' | 'missile';

const MAX_MISSILES = 4;
const MAX_CANNON_AMMO = 240;
const CANNON_COOLDOWN = 0.09;
const MISSILE_COOLDOWN = 1.4;

export class PlayerAircraft implements Targetable {
  id = 'player';
  team: 'player' = 'player';
  kind: 'aircraft' = 'aircraft';
  label = 'Viper One';

  controller: AircraftController;
  visual: AircraftVisual;

  cannonAmmo = MAX_CANNON_AMMO;
  missileCount = MAX_MISSILES;
  selectedWeapon: WeaponType = 'cannon';
  cannonCooldownTimer = 0;
  missileCooldownTimer = 0;

  currentTargetId: string | null = null;
  lockProgress = 0; // 0..1
  locked = false;

  civilianStrikes = 0;

  private group: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.visual = buildAircraft(false);
    this.group = this.visual.group;
    scene.add(this.group);
    const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG });
    this.controller = new AircraftController(this.group, fm);
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

  canFireCannon(): boolean {
    return this.cannonAmmo > 0 && this.cannonCooldownTimer <= 0 && this.controller.alive;
  }

  consumeCannonShot() {
    this.cannonAmmo = Math.max(0, this.cannonAmmo - 1);
    this.cannonCooldownTimer = CANNON_COOLDOWN;
  }

  canFireMissile(): boolean {
    return this.missileCount > 0 && this.missileCooldownTimer <= 0 && this.controller.alive;
  }

  consumeMissile() {
    this.missileCount = Math.max(0, this.missileCount - 1);
    this.missileCooldownTimer = MISSILE_COOLDOWN;
  }

  cycleWeapon() {
    this.selectedWeapon = this.selectedWeapon === 'cannon' ? 'missile' : 'cannon';
  }

  update(dt: number) {
    if (this.cannonCooldownTimer > 0) this.cannonCooldownTimer -= dt;
    if (this.missileCooldownTimer > 0) this.missileCooldownTimer -= dt;

    const fm = this.controller.flightModel;
    const afterburnerOpacity = fm.afterburnerActive ? 0.95 : fm.throttle > 0.15 ? fm.throttle * 0.55 : 0;
    (this.visual.leftEngineGlow.material as THREE.MeshBasicMaterial).opacity = afterburnerOpacity;
    (this.visual.rightEngineGlow.material as THREE.MeshBasicMaterial).opacity = afterburnerOpacity;
    const glowScale = fm.afterburnerActive ? 1.6 : 1;
    this.visual.leftEngineGlow.scale.setScalar(glowScale);
    this.visual.rightEngineGlow.scale.setScalar(glowScale);

    this.visual.gearGroup.visible = fm.gearDown;
    const flapAngle = fm.flapsDown ? 0.4 : 0;
    this.visual.leftFlap.rotation.x = flapAngle;
    this.visual.rightFlap.rotation.x = flapAngle;
  }

  getMuzzleWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.visual.cannonMuzzle.getWorldPosition(out);
    return out;
  }
}
