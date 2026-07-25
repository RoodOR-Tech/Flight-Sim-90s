import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { RadarSystem } from '../systems/RadarSystem';
import { PlayerAircraft } from '../entities/PlayerAircraft';
import { Targetable } from '../game/Types';

class FakeTarget implements Targetable {
  id = 'fake-1';
  team: 'enemy' = 'enemy';
  kind: 'aircraft' = 'aircraft';
  label = 'Fake Bandit';
  private pos: THREE.Vector3;
  private alive = true;
  constructor(pos: THREE.Vector3) {
    this.pos = pos;
  }
  getPosition() {
    return this.pos;
  }
  getVelocity() {
    return new THREE.Vector3();
  }
  isAlive() {
    return this.alive;
  }
  applyDamage() {
    /* noop for this test double */
  }
  getCollisionRadius() {
    return 3;
  }
  kill() {
    this.alive = false;
  }
}

function tick(radar: RadarSystem, player: PlayerAircraft, targets: Targetable[], lockHeld: boolean, seconds: number) {
  const step = 1 / 60;
  let elapsed = 0;
  let lastResult = { justAcquired: false };
  while (elapsed < seconds) {
    lastResult = radar.update(step, player, targets, lockHeld);
    elapsed += step;
  }
  return lastResult;
}

describe('RadarSystem missile-lock eligibility', () => {
  let player: PlayerAircraft;
  let scene: THREE.Scene;
  let radar: RadarSystem;

  beforeEach(() => {
    scene = new THREE.Scene();
    player = new PlayerAircraft(scene);
    radar = new RadarSystem();
  });

  it('cannot lock with no target selected', () => {
    const target = new FakeTarget(new THREE.Vector3(0, 0, -500));
    radar.update(0.1, player, [target], true);
    expect(player.locked).toBe(false);
  });

  it('acquires a lock after holding the lock key on a target directly ahead within range', () => {
    const target = new FakeTarget(new THREE.Vector3(0, 0, -500));
    radar.cycleTarget(player, [target]);
    expect(player.currentTargetId).toBe(target.id);
    const result = tick(radar, player, [target], true, 2);
    expect(player.locked).toBe(true);
    expect(result.justAcquired || player.locked).toBe(true);
  });

  it('does not lock a target far outside the lock cone', () => {
    // Target is far to the side (90 degrees off boresight), well outside the ~32 degree lock cone.
    const target = new FakeTarget(new THREE.Vector3(500, 0, 0));
    radar.cycleTarget(player, [target]);
    tick(radar, player, [target], true, 2);
    expect(player.locked).toBe(false);
  });

  it('does not lock a target beyond maximum lock distance', () => {
    const target = new FakeTarget(new THREE.Vector3(0, 0, -10000));
    radar.cycleTarget(player, [target]);
    tick(radar, player, [target], true, 2);
    expect(player.locked).toBe(false);
  });

  it('drops the lock if the target is destroyed', () => {
    const target = new FakeTarget(new THREE.Vector3(0, 0, -500));
    radar.cycleTarget(player, [target]);
    tick(radar, player, [target], true, 2);
    expect(player.locked).toBe(true);
    target.kill();
    radar.update(0.1, player, [target], true);
    expect(player.locked).toBe(false);
    expect(player.currentTargetId).toBeNull();
  });

  it('does not accumulate lock progress while the lock key is released', () => {
    const target = new FakeTarget(new THREE.Vector3(0, 0, -500));
    radar.cycleTarget(player, [target]);
    radar.update(0.1, player, [target], false);
    expect(player.lockProgress).toBe(0);
    expect(player.locked).toBe(false);
  });
});
