import * as THREE from 'three';
import { GRAVITY } from '../game/Constants';

export const BOMB_BLAST_RADIUS = 32;
export const BOMB_DAMAGE = 140;
const MAX_FALL_TIME = 40;

const bodyGeo = new THREE.CapsuleGeometry(0.22, 1.5, 4, 8);
bodyGeo.rotateX(Math.PI / 2);
const finGeo = new THREE.BoxGeometry(0.7, 0.04, 0.4);
finGeo.translate(0, 0, -0.95);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4d5546, roughness: 0.7, metalness: 0.3 });

/**
 * One ballistic integration step for a free-falling bomb. Shared by the live bomb and the CCIP
 * impact prediction so the pipper shows exactly where a bomb released now will land.
 */
export function stepBallistic(position: THREE.Vector3, velocity: THREE.Vector3, dt: number) {
  velocity.y -= GRAVITY * dt;
  position.addScaledVector(velocity, dt);
}

const predictPos = new THREE.Vector3();
const predictVel = new THREE.Vector3();

/**
 * Predicts where a bomb released at `position` with `velocity` meets the surface.
 * Writes the impact point to `out` and returns false if it would not land within the time limit.
 */
export function predictBombImpact(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  heightAt: (x: number, z: number) => number,
  out: THREE.Vector3,
  dt = 1 / 30,
): boolean {
  predictPos.copy(position);
  predictVel.copy(velocity);
  for (let t = 0; t < MAX_FALL_TIME; t += dt) {
    stepBallistic(predictPos, predictVel, dt);
    const ground = Math.max(0, heightAt(predictPos.x, predictPos.z));
    if (predictPos.y <= ground) {
      out.set(predictPos.x, ground, predictPos.z);
      return true;
    }
  }
  return false;
}

/** An unguided free-fall bomb. It inherits the aircraft's velocity at release and detonates on the surface. */
export class Bomb {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  mesh: THREE.Group;
  alive = true;
  private life = 0;

  constructor(scene: THREE.Scene, origin: THREE.Vector3, velocity: THREE.Vector3) {
    this.position.copy(origin);
    this.velocity.copy(velocity);
    this.mesh = new THREE.Group();
    this.mesh.add(new THREE.Mesh(bodyGeo, bodyMat));
    const fin = new THREE.Mesh(finGeo, bodyMat);
    this.mesh.add(fin);
    const fin2 = fin.clone();
    fin2.rotation.z = Math.PI / 2;
    this.mesh.add(fin2);
    this.mesh.position.copy(origin);
    scene.add(this.mesh);
  }

  /** Advances the fall. Returns true on the step it reaches the surface (position is snapped to it). */
  update(dt: number, heightAt: (x: number, z: number) => number): boolean {
    if (!this.alive) return false;
    this.life += dt;
    stepBallistic(this.position, this.velocity, dt);
    const ground = Math.max(0, heightAt(this.position.x, this.position.z));
    if (this.position.y <= ground || this.life > MAX_FALL_TIME) {
      this.position.y = ground;
      this.alive = false;
      this.mesh.position.copy(this.position);
      return true;
    }
    this.mesh.position.copy(this.position);
    // Nose (+Z) follows the fall line; the fins trail.
    this.mesh.lookAt(this.position.x + this.velocity.x, this.position.y + this.velocity.y, this.position.z + this.velocity.z);
    return false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
  }
}
