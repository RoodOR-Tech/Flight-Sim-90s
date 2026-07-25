import * as THREE from 'three';
import { GRAVITY } from '../game/Constants';

export interface FlightControls {
  /** -1..1, positive pulls the nose up */
  pitch: number;
  /** -1..1, positive rolls right */
  roll: number;
  /** -1..1, positive yaws right */
  yaw: number;
  /** -1, 0, or 1 throttle lever direction */
  throttleInput: number;
  afterburner: boolean;
}

export interface FlightModelConfig {
  thrustAccel: number;
  afterburnerBonus: number;
  dragCoeff: number;
  gearFlapsDragBonus: number;
  stallSpeed: number;
  minControlSpeed: number;
  fullControlSpeed: number;
  maxRollRate: number;
  maxPitchRate: number;
  maxYawRate: number;
  throttleRate: number;
  maxHealth: number;
}

export const DEFAULT_FLIGHT_CONFIG: FlightModelConfig = {
  thrustAccel: 28,
  afterburnerBonus: 24,
  dragCoeff: 0.00046,
  gearFlapsDragBonus: 0.0009,
  stallSpeed: 42,
  minControlSpeed: 18,
  fullControlSpeed: 70,
  maxRollRate: 2.4,
  maxPitchRate: 1.15,
  maxYawRate: 0.55,
  throttleRate: 0.55,
  maxHealth: 100,
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);
const UP_LOCAL = new THREE.Vector3(0, 1, 0);
const RIGHT_LOCAL = new THREE.Vector3(1, 0, 0);

/**
 * A lightweight "lift-vector" arcade flight model: thrust/drag/gravity act on a velocity vector,
 * a lift force along the aircraft's own up-axis approximately cancels gravity above stall speed
 * (which is what produces banked turns for free), and a weathervane damping term bleeds off
 * sideways drift so the plane flies where it points instead of sliding like a free camera.
 */
export class FlightModel {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  quaternion = new THREE.Quaternion();

  throttle = 0; // 0..1
  afterburnerActive = false;
  gearDown = true;
  flapsDown = false;
  stalling = false;
  onGround = false;
  turbulence = true;

  constructor(public config: FlightModelConfig = DEFAULT_FLIGHT_CONFIG) {}

  getForward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(FORWARD_LOCAL).applyQuaternion(this.quaternion);
  }

  getUp(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(UP_LOCAL).applyQuaternion(this.quaternion);
  }

  getRight(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(RIGHT_LOCAL).applyQuaternion(this.quaternion);
  }

  getSpeed(): number {
    return this.velocity.length();
  }

  getHeadingDegrees(): number {
    const fwd = this.getForward();
    let deg = Math.atan2(fwd.x, -fwd.z) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return deg;
  }

  getPitchDegrees(): number {
    const fwd = this.getForward();
    return Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) * (180 / Math.PI);
  }

  getRollDegrees(): number {
    const right = this.getRight();
    const up = this.getUp();
    // roll angle derived from how much the right vector dips below/above the horizontal plane
    const level = new THREE.Vector3(right.x, 0, right.z).normalize();
    let angle = Math.atan2(right.y, level.length()) * (180 / Math.PI);
    if (up.y < 0) angle = angle >= 0 ? 180 - angle : -180 - angle;
    return angle;
  }

  controlAuthority(): number {
    const { minControlSpeed, fullControlSpeed } = this.config;
    return THREE.MathUtils.clamp(
      (this.getSpeed() - minControlSpeed) / (fullControlSpeed - minControlSpeed),
      0.15,
      1,
    );
  }

  private tmpForward = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();

  step(dt: number, controls: FlightControls) {
    // Throttle
    this.throttle = THREE.MathUtils.clamp(
      this.throttle + controls.throttleInput * this.config.throttleRate * dt,
      0,
      1,
    );
    this.afterburnerActive = controls.afterburner && this.throttle > 0.5;

    const speed = this.getSpeed();
    const authority = this.controlAuthority();
    const forward = this.getForward(this.tmpForward);
    const up = this.getUp(this.tmpUp);

    // --- Rotation ---
    const pitchRate = controls.pitch * this.config.maxPitchRate * authority;
    const rollRate = controls.roll * this.config.maxRollRate * authority;
    const yawRate = controls.yaw * this.config.maxYawRate * authority;

    let turbPitch = 0;
    let turbRoll = 0;
    if (this.turbulence && this.position.y < 80 && speed > this.config.stallSpeed) {
      const t = performance.now() * 0.002;
      turbPitch = Math.sin(t * 3.1 + this.position.x * 0.01) * 0.05;
      turbRoll = Math.sin(t * 2.3 + this.position.z * 0.01) * 0.08;
    }

    const qPitch = new THREE.Quaternion().setFromAxisAngle(AXIS_X, (pitchRate + turbPitch) * dt);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -(rollRate + turbRoll) * dt);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, -yawRate * dt);
    this.quaternion.multiply(qYaw).multiply(qPitch).multiply(qRoll);
    this.quaternion.normalize();

    // --- Forces ---
    const accel = new THREE.Vector3();

    const thrustAccel =
      this.config.thrustAccel * this.throttle + (this.afterburnerActive ? this.config.afterburnerBonus : 0);
    accel.addScaledVector(forward, thrustAccel);

    let dragCoeff = this.config.dragCoeff;
    if (this.gearDown) dragCoeff += this.config.gearFlapsDragBonus * 0.6;
    if (this.flapsDown) dragCoeff += this.config.gearFlapsDragBonus;
    const dragMag = dragCoeff * speed * speed;
    if (speed > 0.01) {
      accel.addScaledVector(this.velocity, -dragMag / speed);
    }

    accel.y -= GRAVITY;

    const effectiveStall = this.flapsDown ? this.config.stallSpeed * 0.7 : this.config.stallSpeed;
    const liftFactor = THREE.MathUtils.clamp(speed / effectiveStall, 0, 1.35);
    this.stalling = liftFactor < 1;
    accel.addScaledVector(up, GRAVITY * liftFactor);

    this.velocity.addScaledVector(accel, dt);

    // Weathervane damping: bleed off velocity component perpendicular to the nose so the
    // aircraft tends to fly the direction it's pointed, like a plane rather than a drone.
    const newSpeed = this.velocity.length();
    if (newSpeed > 0.5) {
      const along = this.velocity.dot(forward);
      const alongVec = forward.clone().multiplyScalar(along);
      const perp = this.velocity.clone().sub(alongVec);
      const weathervaneRate = THREE.MathUtils.clamp(newSpeed / 30, 0.5, 4);
      perp.multiplyScalar(Math.exp(-weathervaneRate * dt));
      this.velocity.copy(alongVec.add(perp));
    }

    this.position.addScaledVector(this.velocity, dt);

    if (this.position.y < 0.05 && !this.onGround) {
      // simple safety clamp; real collision handling happens in CollisionSystem
      this.position.y = 0.05;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
  }
}
