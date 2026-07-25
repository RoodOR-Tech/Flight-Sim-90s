import * as THREE from 'three';
import { FlightControls, FlightModel } from './FlightModel';
import { ActionKey, InputManager } from '../game/InputManager';

export interface DamageEvent {
  amount: number;
  fromDirection: THREE.Vector3; // world-space direction the hit came from
}

/**
 * Wraps a FlightModel with input mapping, health/gear/flap state, and a mesh transform sync.
 * Shared by the player and (with AI-driven controls instead of keyboard) enemy aircraft.
 */
export class AircraftController {
  flightModel: FlightModel;
  mesh: THREE.Object3D;
  health: number;
  maxHealth: number;
  alive = true;
  destroyed = false;

  private gearToggleCooldown = 0;
  private flapToggleCooldown = 0;

  constructor(mesh: THREE.Object3D, flightModel: FlightModel) {
    this.mesh = mesh;
    this.flightModel = flightModel;
    this.maxHealth = flightModel.config.maxHealth;
    this.health = this.maxHealth;
  }

  applyDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.health = Math.max(0, Math.min(this.maxHealth, this.health - amount));
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      return true; // just died
    }
    return false;
  }

  healthFraction(): number {
    return THREE.MathUtils.clamp(this.health / this.maxHealth, 0, 1);
  }

  toggleGear(): boolean {
    if (this.gearToggleCooldown > 0) return this.flightModel.gearDown;
    this.gearToggleCooldown = 1.2;
    this.flightModel.gearDown = !this.flightModel.gearDown;
    return this.flightModel.gearDown;
  }

  toggleFlaps(): boolean {
    if (this.flapToggleCooldown > 0) return this.flightModel.flapsDown;
    this.flapToggleCooldown = 0.6;
    this.flightModel.flapsDown = !this.flightModel.flapsDown;
    return this.flightModel.flapsDown;
  }

  step(dt: number, controls: FlightControls) {
    if (this.gearToggleCooldown > 0) this.gearToggleCooldown -= dt;
    if (this.flapToggleCooldown > 0) this.flapToggleCooldown -= dt;
    this.flightModel.step(dt, controls);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.flightModel.position);
    this.mesh.quaternion.copy(this.flightModel.quaternion);
  }
}

/** Reads keyboard/gamepad-style input and produces FlightControls for the player each frame. */
export class PlayerInputAdapter {
  constructor(private input: InputManager) {}

  read(): FlightControls {
    const pitch = this.axis('pitchUp', 'pitchDown');
    const roll = this.axis('rollRight', 'rollLeft');
    const yaw = this.axis('yawRight', 'yawLeft');
    const throttleInput = this.axis('throttleUp', 'throttleDown');
    const afterburner = this.input.isHeld('afterburner');
    return { pitch, roll, yaw, throttleInput, afterburner };
  }

  private axis(pos: ActionKey, neg: ActionKey): number {
    let v = 0;
    if (this.input.isHeld(pos)) v += 1;
    if (this.input.isHeld(neg)) v -= 1;
    return v;
  }
}
