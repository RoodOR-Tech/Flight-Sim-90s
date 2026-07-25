import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MissionManager } from '../game/MissionManager';
import { WORLD_LAYOUT } from '../world/WorldBuilder';

function baseInput(overrides: Partial<Parameters<MissionManager['update']>[1]> = {}) {
  return {
    playerAlive: true,
    playerPosition: new THREE.Vector3(0, 300, 0),
    enemiesRemaining: 2,
    radarDestroyed: false,
    landedSuccessfully: false,
    civilianStrikes: 0,
    ...overrides,
  };
}

describe('MissionManager stage progression', () => {
  let mission: MissionManager;

  beforeEach(() => {
    mission = new MissionManager();
  });

  it('starts in the launch stage', () => {
    expect(mission.stage).toBe('launch');
  });

  it('advances to to_alpha once flight begins', () => {
    mission.beginFlight();
    expect(mission.stage).toBe('to_alpha');
  });

  it('advances to intercept on reaching waypoint Alpha', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone() }));
    expect(mission.stage).toBe('intercept');
  });

  it('does not advance past intercept until both enemies are destroyed', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone() }));
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone(), enemiesRemaining: 1 }));
    expect(mission.stage).toBe('intercept');
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone(), enemiesRemaining: 0 }));
    expect(mission.stage).toBe('to_bravo');
  });

  it('advances through the radar strike and RTB stages in order', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone() }));
    expect(mission.stage).toBe('intercept');
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone(), enemiesRemaining: 0 }));
    expect(mission.stage).toBe('to_bravo');
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointBravo.clone(), enemiesRemaining: 0 }));
    expect(mission.stage).toBe('strike_radar');
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointBravo.clone(), enemiesRemaining: 0, radarDestroyed: true }));
    expect(mission.stage).toBe('rtb');
  });

  it('fails the mission when the player is destroyed', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ playerAlive: false }));
    expect(mission.stage).toBe('failed');
    expect(mission.failReason).toContain('lost');
  });

  it('fails the mission after repeated civilian strikes', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ civilianStrikes: 1 }));
    expect(mission.stage).not.toBe('failed');
    mission.update(0.1, baseInput({ civilianStrikes: 3 }));
    expect(mission.stage).toBe('failed');
  });

  it('does not transition stages once the mission has already ended', () => {
    mission.beginFlight();
    mission.update(0.1, baseInput({ playerAlive: false }));
    expect(mission.stage).toBe('failed');
    mission.update(0.1, baseInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone() }));
    expect(mission.stage).toBe('failed');
  });
});
