import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  IDENTITY_TRANSFORM,
  applyModelTransform,
  makeTransform,
  normalizeModelSize,
} from '../rendering/ModelTransform';

describe('makeTransform', () => {
  it('fills in identity defaults for omitted fields', () => {
    const t = makeTransform({});
    expect(t).toEqual(IDENTITY_TRANSFORM);
  });

  it('merges partial rotation without dropping the other axes', () => {
    const t = makeTransform({ rotation: { y: 180 } as any });
    expect(t.rotation).toEqual({ x: 0, y: 180, z: 0 });
    expect(t.scale).toBe(1);
  });

  it('accepts a full override', () => {
    const t = makeTransform({ scale: 2, rotation: { x: 10, y: 20, z: 30 }, offset: { x: 1, y: 2, z: 3 } });
    expect(t.scale).toBe(2);
    expect(t.rotation.z).toBe(30);
    expect(t.offset.y).toBe(2);
  });
});

describe('applyModelTransform', () => {
  it('applies scale, rotation in degrees, and offset in metres', () => {
    const obj = new THREE.Object3D();
    applyModelTransform(obj, makeTransform({ scale: 3, rotation: { x: 0, y: 90, z: 0 }, offset: { x: 5, y: 0, z: -2 } }));
    expect(obj.scale.x).toBeCloseTo(3);
    expect(obj.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(obj.position.x).toBeCloseTo(5);
    expect(obj.position.z).toBeCloseTo(-2);
  });

  it('multiplies into an existing scale rather than replacing it', () => {
    const obj = new THREE.Object3D();
    obj.scale.setScalar(2);
    applyModelTransform(obj, makeTransform({ scale: 4 }));
    expect(obj.scale.x).toBeCloseTo(8);
  });
});

function boxObject(x: number, y: number, z: number, offset = new THREE.Vector3()): THREE.Mesh {
  const geo = new THREE.BoxGeometry(x, y, z);
  geo.translate(offset.x, offset.y, offset.z);
  return new THREE.Mesh(geo);
}

describe('normalizeModelSize', () => {
  it('scales the longest axis to the requested target length', () => {
    const mesh = boxObject(4, 1, 2);
    const result = normalizeModelSize(mesh, 20);
    expect(result.scale).toBeCloseTo(5);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(20, 3);
  });

  it('recentres the model on its bounding-box centre', () => {
    const mesh = boxObject(2, 2, 2, new THREE.Vector3(50, 0, 0));
    normalizeModelSize(mesh, 2);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(center.length()).toBeLessThan(1e-6);
  });

  it('can skip recentring when asked', () => {
    const mesh = boxObject(2, 2, 2, new THREE.Vector3(10, 0, 0));
    normalizeModelSize(mesh, 2, false);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(center.x).toBeGreaterThan(1);
  });

  it('flags an implausible scale factor as a likely unit mismatch', () => {
    // A 1000 m "aircraft" scaled to 9 m needs ~0.009x — clearly a centimetre/metre confusion.
    const huge = boxObject(1000, 100, 200);
    expect(normalizeModelSize(huge, 9).suspectScale).toBe(true);

    // A 0.05 m model scaled to 9 m needs 180x — also suspect.
    const tiny = boxObject(0.05, 0.01, 0.02);
    expect(normalizeModelSize(tiny, 9).suspectScale).toBe(true);
  });

  it('does not flag a reasonable scale factor', () => {
    const sane = boxObject(9.5, 3, 7);
    const result = normalizeModelSize(sane, 9.2);
    expect(result.suspectScale).toBe(false);
    expect(result.scale).toBeCloseTo(9.2 / 9.5, 4);
  });

  it('returns a safe result for degenerate geometry instead of dividing by zero', () => {
    const empty = new THREE.Object3D();
    const result = normalizeModelSize(empty, 10);
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.suspectScale).toBe(true);
  });
});
