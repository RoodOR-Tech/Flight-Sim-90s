import * as THREE from 'three';

const SPEED = 780;
const MAX_RANGE = 950;
const TRACER_LENGTH = 9;

const tracerGeo = new THREE.CylinderGeometry(0.045, 0.045, TRACER_LENGTH, 5);
tracerGeo.rotateX(Math.PI / 2);
tracerGeo.translate(0, 0, -TRACER_LENGTH / 2);

export type ProjectileOwner = 'player' | 'enemy';

/** A fast cannon round rendered as a short glowing tracer streak; collision is a swept-sphere test each step. */
export class Projectile {
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  owner: ProjectileOwner;
  distanceTraveled = 0;
  alive = true;
  mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, origin: THREE.Vector3, direction: THREE.Vector3, spread: number, owner: ProjectileOwner) {
    this.position = origin.clone();
    this.previousPosition = origin.clone();
    const dir = direction.clone().normalize();
    if (spread > 0) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    this.velocity = dir.multiplyScalar(SPEED);
    this.owner = owner;
    const mat = new THREE.MeshBasicMaterial({ color: owner === 'player' ? 0xbfffcc : 0xffcf7a });
    this.mesh = new THREE.Mesh(tracerGeo, mat);
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(this.mesh);
  }

  update(dt: number) {
    if (!this.alive) return;
    this.previousPosition.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);
    this.distanceTraveled += SPEED * dt;
    this.mesh.position.copy(this.position);
    if (this.distanceTraveled > MAX_RANGE || this.position.y < 0) {
      this.alive = false;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
  }
}

/** Line-segment vs sphere intersection test, used so fast rounds can't tunnel through thin targets. */
export function segmentHitsSphere(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): boolean {
  const d = p1.clone().sub(p0);
  const f = p0.clone().sub(center);
  const a = d.dot(d);
  if (a < 1e-8) return p0.distanceTo(center) <= radius;
  const b = 2 * f.dot(d);
  const c = f.dot(f) - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}
