import * as THREE from 'three';
import { AircraftController } from '../flight/AircraftController';
import { FlightModel, DEFAULT_FLIGHT_CONFIG } from '../flight/FlightModel';
import { Targetable } from '../game/Types';
import { AircraftModelResult, buildAircraftModel } from '../rendering/models/AircraftModel';
import { buildMissileVisual } from '../rendering/models/MissileModel';
import { GraphicsSettings } from '../rendering/GraphicsPresets';

export type WeaponType = 'cannon' | 'missile';

const MAX_MISSILES = 4;
const MAX_CANNON_AMMO = 240;
const CANNON_COOLDOWN = 0.09;
const MISSILE_COOLDOWN = 1.4;

/**
 * The player's aircraft.
 *
 * Structure (gameplay owns `root`; everything visual hangs beneath it):
 *
 *   root                    <- driven by FlightModel, the only transform gameplay writes
 *    +- collisionVolume     <- simple sphere proxy, never rendered
 *    +- visualRoot          <- detailed procedural model (or a GLB, if one is supplied)
 *        +- hardpoints / engine points / damage points
 */
export class PlayerAircraft implements Targetable {
  id = 'player';
  team: 'player' = 'player';
  kind: 'aircraft' = 'aircraft';
  label = 'Viper One';

  controller: AircraftController;
  /** Entity root. Gameplay writes this transform; visuals are children. */
  root = new THREE.Group();
  visualRoot = new THREE.Group();
  model: AircraftModelResult;
  collisionVolume: THREE.Sphere;

  cannonAmmo = MAX_CANNON_AMMO;
  missileCount = MAX_MISSILES;
  selectedWeapon: WeaponType = 'cannon';
  cannonCooldownTimer = 0;
  missileCooldownTimer = 0;

  currentTargetId: string | null = null;
  lockProgress = 0; // 0..1
  locked = false;

  civilianStrikes = 0;
  /** Scales incoming weapon damage; set from the difficulty table at mission start. */
  damageMultiplier = 1;

  private missileVisuals: THREE.Object3D[] = [];
  private navLightPhase = 0;
  private gearAnim = 1; // 1 = down, 0 = up
  private flapAnim = 0;

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.root.name = 'player-root';
    this.model = buildAircraftModel('sea-viper', settings);
    this.visualRoot.add(this.model.group);
    this.root.add(this.visualRoot);
    scene.add(this.root);

    // Collision proxy: a single sphere sized from the airframe, deliberately independent of the
    // visual mesh so remodelling never changes hit behaviour.
    this.collisionVolume = new THREE.Sphere(new THREE.Vector3(), 3.2);

    const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG });
    this.controller = new AircraftController(this.root, fm);

    this.attachMissiles();
  }

  /** Puts a missile body on each hardpoint; they are hidden as rounds are expended. */
  private attachMissiles() {
    for (const hp of this.model.hardpoints) {
      const missile = buildMissileVisual(0.72);
      hp.add(missile);
      this.missileVisuals.push(missile);
    }
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
    return this.collisionVolume.radius;
  }

  applyDamage(amount: number): void {
    this.controller.applyDamage(amount * this.damageMultiplier);
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
    this.refreshMissileVisuals();
  }

  private refreshMissileVisuals() {
    // Hide pylon rounds from the outboard stations inward as they are fired.
    for (let i = 0; i < this.missileVisuals.length; i++) {
      this.missileVisuals[i].visible = i < this.missileCount;
    }
  }

  cycleWeapon() {
    this.selectedWeapon = this.selectedWeapon === 'cannon' ? 'missile' : 'cannon';
  }

  /** Resets all per-mission state, reusing the existing scene objects. */
  resetForMission() {
    this.cannonAmmo = MAX_CANNON_AMMO;
    this.missileCount = MAX_MISSILES;
    this.selectedWeapon = 'cannon';
    this.cannonCooldownTimer = 0;
    this.missileCooldownTimer = 0;
    this.currentTargetId = null;
    this.lockProgress = 0;
    this.locked = false;
    this.civilianStrikes = 0;
    this.controller.health = this.controller.maxHealth;
    this.controller.alive = true;
    this.controller.destroyed = false;
    this.root.visible = true;
    this.refreshMissileVisuals();
  }

  update(dt: number) {
    if (this.cannonCooldownTimer > 0) this.cannonCooldownTimer -= dt;
    if (this.missileCooldownTimer > 0) this.missileCooldownTimer -= dt;

    const fm = this.controller.flightModel;

    // --- Engine / afterburner visuals ---
    const throttle = fm.throttle;
    const glowOpacity = fm.afterburnerActive ? 0.95 : throttle > 0.12 ? throttle * 0.6 : 0;
    for (const glow of this.model.engineGlows) {
      const mat = glow.material as THREE.MeshBasicMaterial;
      mat.opacity = glowOpacity;
      const scale = fm.afterburnerActive ? 1.35 : 0.85 + throttle * 0.35;
      glow.scale.setScalar(scale);
    }
    for (const flame of this.model.afterburnerFlames) {
      const mat = flame.material as THREE.MeshBasicMaterial;
      // Flicker so the plume looks unstable rather than a static cone.
      const flicker = 0.82 + Math.sin(performance.now() * 0.05) * 0.18;
      mat.opacity = fm.afterburnerActive ? 0.6 * flicker : 0;
      flame.scale.set(1, 1, fm.afterburnerActive ? flicker : 0.01);
    }

    // --- Gear / flap animation (smoothed toward target state) ---
    const gearTarget = fm.gearDown ? 1 : 0;
    this.gearAnim += (gearTarget - this.gearAnim) * Math.min(1, dt * 3.2);
    this.model.gearGroup.visible = this.gearAnim > 0.02;
    // Retract by rotating the whole gear group up into the fuselage.
    this.model.gearGroup.rotation.x = (1 - this.gearAnim) * -1.35;
    this.model.gearGroup.scale.setScalar(0.35 + this.gearAnim * 0.65);
    for (const door of this.model.gearDoors) {
      door.rotation.z = (1 - this.gearAnim) * 1.2;
    }

    const flapTarget = fm.flapsDown ? 1 : 0;
    this.flapAnim += (flapTarget - this.flapAnim) * Math.min(1, dt * 4);
    this.model.leftFlap.rotation.x = this.flapAnim * 0.45;
    this.model.rightFlap.rotation.x = this.flapAnim * 0.45;

    // --- Control-surface deflection driven by the actual control inputs ---
    const roll = THREE.MathUtils.clamp(fm.lastControls.roll, -1, 1);
    const pitch = THREE.MathUtils.clamp(fm.lastControls.pitch, -1, 1);
    const yaw = THREE.MathUtils.clamp(fm.lastControls.yaw, -1, 1);
    this.model.rightAileron.rotation.x = -roll * 0.4 + pitch * 0.12;
    this.model.leftAileron.rotation.x = roll * 0.4 + pitch * 0.12;
    for (const rudder of this.model.rudders) rudder.rotation.y = -yaw * 0.35;

    // --- Nav-light strobe ---
    this.navLightPhase += dt;
    const strobeOn = this.navLightPhase % 1.5 < 0.12;
    const tailLight = this.model.navLights[this.model.navLights.length - 1];
    if (tailLight) tailLight.visible = strobeOn;
  }

  /** World-space muzzle position for cannon fire. */
  getMuzzleWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.cannonMuzzle.getWorldPosition(out);
    return out;
  }

  /** World-space launch point for the next missile (the outermost loaded pylon). */
  getMissileLaunchPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const index = Math.max(0, Math.min(this.model.hardpoints.length - 1, this.missileCount - 1));
    this.model.hardpoints[index].getWorldPosition(out);
    return out;
  }

  getEngineWorldPositions(out: THREE.Vector3[] = []): THREE.Vector3[] {
    out.length = 0;
    for (const p of this.model.engineEffectPoints) {
      out.push(p.getWorldPosition(new THREE.Vector3()));
    }
    return out;
  }

  getDamageWorldPositions(out: THREE.Vector3[] = []): THREE.Vector3[] {
    out.length = 0;
    for (const p of this.model.damageEffectPoints) {
      out.push(p.getWorldPosition(new THREE.Vector3()));
    }
    return out;
  }

  /** Hides the airframe (used after destruction so only the wreck effect remains). */
  setVisible(v: boolean) {
    this.root.visible = v;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    this.model.dispose();
  }
}
