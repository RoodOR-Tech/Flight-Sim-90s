import * as THREE from 'three';

/**
 * Critically-damped spring integrators (semi-implicit Euler).
 *
 * Pattern reference: OpenSkyFlight `js/camera/SpringVector3.js` / `SpringScalar.js` (MIT).
 * When `damping` is 0 the critical value `2·sqrt(stiffness)` is used, which converges without
 * overshoot — the behaviour we want for a chase camera that should feel firm rather than floaty.
 */
export class SpringVector3 {
  value: THREE.Vector3;
  velocity = new THREE.Vector3();
  private delta = new THREE.Vector3();
  private accel = new THREE.Vector3();

  constructor(initial?: THREE.Vector3) {
    this.value = initial ? initial.clone() : new THREE.Vector3();
  }

  update(target: THREE.Vector3, stiffness: number, damping: number, dt: number) {
    const d = damping === 0 ? 2 * Math.sqrt(stiffness) : damping;
    this.delta.subVectors(target, this.value);
    this.accel.copy(this.delta).multiplyScalar(stiffness).addScaledVector(this.velocity, -d);
    this.velocity.addScaledVector(this.accel, dt);
    this.value.addScaledVector(this.velocity, dt);
  }

  reset(position: THREE.Vector3) {
    this.value.copy(position);
    this.velocity.set(0, 0, 0);
  }
}

export class SpringScalar {
  value: number;
  velocity = 0;

  constructor(initial = 0) {
    this.value = initial;
  }

  update(target: number, stiffness: number, damping: number, dt: number) {
    const d = damping === 0 ? 2 * Math.sqrt(stiffness) : damping;
    const accel = (target - this.value) * stiffness - this.velocity * d;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
  }

  reset(v: number) {
    this.value = v;
    this.velocity = 0;
  }
}
