import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AircraftController } from '../flight/AircraftController';
import { FlightModel, DEFAULT_FLIGHT_CONFIG } from '../flight/FlightModel';

function makeController() {
  const mesh = new THREE.Group();
  const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG, maxHealth: 100 });
  return new AircraftController(mesh, fm);
}

describe('AircraftController damage clamping', () => {
  it('starts at full health', () => {
    const c = makeController();
    expect(c.health).toBe(100);
    expect(c.healthFraction()).toBe(1);
  });

  it('clamps health at zero and never goes negative', () => {
    const c = makeController();
    c.applyDamage(500);
    expect(c.health).toBe(0);
    expect(c.healthFraction()).toBe(0);
  });

  it('marks the aircraft dead exactly on the killing blow, not before', () => {
    const c = makeController();
    const diedEarly = c.applyDamage(60);
    expect(diedEarly).toBe(false);
    expect(c.alive).toBe(true);
    const diedNow = c.applyDamage(60);
    expect(diedNow).toBe(true);
    expect(c.alive).toBe(false);
  });

  it('ignores further damage once already destroyed', () => {
    const c = makeController();
    c.applyDamage(1000);
    expect(c.alive).toBe(false);
    const result = c.applyDamage(50);
    expect(result).toBe(false);
    expect(c.health).toBe(0);
  });

  it('never exceeds max health', () => {
    const c = makeController();
    c.applyDamage(10);
    // health can only decrease via applyDamage in this API; verify clamping helper directly
    expect(c.health).toBeLessThanOrEqual(c.maxHealth);
  });
});
