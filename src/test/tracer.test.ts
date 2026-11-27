import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Projectile } from '../entities/Projectile';

describe('tracer visuals', () => {
  it.each(['player', 'enemy'] as const)('keeps the %s streak behind its head at oblique headings', (owner) => {
    const direction = new THREE.Vector3(1, -0.15, 0.8).normalize();
    const round = new Projectile(new THREE.Scene(), new THREE.Vector3(0, 100, 0), direction, 0, owner);
    round.update(1 / 60);
    expect(round.mesh.position.distanceTo(round.position)).toBe(0);
    const tail = new THREE.Vector3(0, 0, 1).applyQuaternion(round.mesh.quaternion);
    expect(tail.dot(direction)).toBeCloseTo(-1);
    const vertices = round.mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) expect(vertices.getZ(i)).toBeGreaterThanOrEqual(0);
  });
});
