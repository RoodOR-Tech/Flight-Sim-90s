import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { MissionManager } from '../game/MissionManager';
import { CombatSystem, CombatContext } from '../systems/CombatSystem';
import { calculateScore } from '../systems/ScoringSystem';
import { predictBombImpact, BOMB_BLAST_RADIUS } from '../entities/Bomb';
import { GroundUnit, FLAK_RANGE } from '../entities/GroundUnit';
import { DIFFICULTY_TABLE, GRAVITY } from '../game/Constants';
import { resolvePreset } from '../rendering/GraphicsPresets';
import { WORLD_LAYOUT } from '../world/WorldLayout';
import { TerrainField } from '../world/TerrainField';

function missionInput(overrides: Partial<Parameters<MissionManager['update']>[1]> = {}) {
  return {
    playerAlive: true,
    playerPosition: new THREE.Vector3(0, 300, 0),
    enemiesRemaining: 0,
    radarDestroyed: false,
    landedSuccessfully: false,
    civilianStrikes: 0,
    armorRemaining: 6,
    ...overrides,
  };
}

function combatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const effects = {
    smokePuff: vi.fn(),
    explosion: vi.fn(),
    notifyDamage: vi.fn(),
    waterSplash: vi.fn(),
    groundImpact: vi.fn(),
    addShake: vi.fn(),
  };
  return {
    scene: new THREE.Scene(),
    player: {
      id: 'player',
      isAlive: () => true,
      getPosition: () => new THREE.Vector3(0, 5000, 0),
      getCollisionRadius: () => 3,
      applyDamage: vi.fn(),
    } as unknown as CombatContext['player'],
    hostileTargets: [],
    civilianStructures: [],
    effects: effects as unknown as CombatContext['effects'],
    audio: { explosion: vi.fn() } as unknown as CombatContext['audio'],
    terrainHeightAt: () => 0,
    ...overrides,
  };
}

function fakeTarget(position: THREE.Vector3, health = 50) {
  let hp = health;
  return {
    id: `t-${position.x}`,
    team: 'enemy' as const,
    kind: 'ground' as const,
    label: 'tank',
    getPosition: () => position,
    getVelocity: () => new THREE.Vector3(),
    isAlive: () => hp > 0,
    getCollisionRadius: () => 4.2,
    applyDamage: (amount: number) => {
      hp -= amount;
    },
  };
}

describe('Operation Iron Anvil stage progression', () => {
  it('goes coast -> strike -> rtb and never enters the fighter or radar stages', () => {
    const mission = new MissionManager();
    mission.reset('iron_anvil');
    mission.beginFlight();
    expect(mission.stage).toBe('to_alpha');
    expect(mission.currentWaypoint()).toBe(WORLD_LAYOUT.waypointCoast);

    // Crossing the coast at a different altitude still counts.
    const overCoast = WORLD_LAYOUT.waypointCoast.clone().setY(1500);
    mission.update(0.1, missionInput({ playerPosition: overCoast }));
    expect(mission.stage).toBe('strike_armor');

    mission.update(0.1, missionInput({ playerPosition: overCoast, armorRemaining: 1 }));
    expect(mission.stage).toBe('strike_armor');

    mission.update(0.1, missionInput({ playerPosition: overCoast, armorRemaining: 0 }));
    expect(mission.stage).toBe('rtb');
  });

  it('leaves mission 1 behaviour unchanged by default', () => {
    const mission = new MissionManager();
    mission.reset();
    mission.beginFlight();
    mission.update(0.1, missionInput({ playerPosition: WORLD_LAYOUT.waypointAlpha.clone(), enemiesRemaining: 2 }));
    expect(mission.stage).toBe('intercept');
  });
});

describe('bombs', () => {
  it('predicts a level release using the vacuum ballistic range', () => {
    const out = new THREE.Vector3();
    const height = 500;
    const speed = 150;
    const ok = predictBombImpact(new THREE.Vector3(0, height, 0), new THREE.Vector3(0, 0, -speed), () => 0, out, 1 / 240);
    expect(ok).toBe(true);
    const expectedRange = speed * Math.sqrt((2 * height) / GRAVITY);
    expect(Math.abs(-out.z - expectedRange)).toBeLessThan(3);
    expect(out.y).toBe(0);
  });

  it('lands where the prediction said, on raised terrain', () => {
    const heightAt = () => 40;
    const origin = new THREE.Vector3(10, 400, 20);
    const velocity = new THREE.Vector3(30, -20, -120);
    const predicted = new THREE.Vector3();
    predictBombImpact(origin, velocity, heightAt, predicted, 1 / 60);

    const combat = new CombatSystem();
    const ctx = combatContext({ terrainHeightAt: heightAt });
    combat.dropBomb(ctx.scene, origin, velocity);
    let steps = 0;
    while (combat.bombs.length > 0 && steps++ < 5000) combat.update(1 / 60, ctx);
    expect(combat.bombs.length).toBe(0);
    const explosion = (ctx.effects.explosion as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as THREE.Vector3;
    expect(explosion.distanceTo(predicted)).toBeLessThan(0.01);
    expect(explosion.y).toBe(40);
  });

  it('destroys a tank near the impact and spares one outside the blast', () => {
    const near = fakeTarget(new THREE.Vector3(15, 1.3, 0));
    const far = fakeTarget(new THREE.Vector3(BOMB_BLAST_RADIUS + 30, 1.3, 0));
    const combat = new CombatSystem();
    const ctx = combatContext({ hostileTargets: [near, far] });
    combat.dropBomb(ctx.scene, new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -50, 0));
    const events = combat.update(1 / 10, ctx);
    expect(near.isAlive()).toBe(false);
    expect(far.isAlive()).toBe(true);
    expect(events).toContainEqual({ type: 'target-destroyed', targetId: near.id });
  });

  it('reports a civilian hit when a bomb lands next to a protected structure', () => {
    const combat = new CombatSystem();
    const ctx = combatContext({ civilianStructures: [{ position: new THREE.Vector3(10, 2, 0), radius: 5 }] });
    combat.dropBomb(ctx.scene, new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -50, 0));
    expect(combat.update(1 / 10, ctx)).toContainEqual({ type: 'civilian-hit' });
  });
});

describe('ground units', () => {
  const settings = resolvePreset('low');
  const flat = () => 12;

  it('drives a tank along its route on the terrain and halts short as ordered', () => {
    const tank = new GroundUnit(
      new THREE.Scene(),
      { kind: 'tank', id: 'tank-x', start: new THREE.Vector3(0, 0, 0), destination: new THREE.Vector3(100, 0, 0), haltShort: 30 },
      flat,
      DIFFICULTY_TABLE.normal,
      settings,
    );
    const far = new THREE.Vector3(9999, 9999, 9999);
    expect(tank.isMoving()).toBe(true);
    for (let i = 0; i < 60 * 30; i++) tank.update(1 / 60, far, new THREE.Vector3(), true);
    expect(tank.isMoving()).toBe(false);
    expect(tank.root.position.x).toBeCloseTo(70, 3);
    expect(tank.root.position.y).toBe(12);
    expect(tank.fireRequested).toBe(false);
  });

  it('dies after enough damage and stops being a live target', () => {
    const tank = new GroundUnit(new THREE.Scene(), { kind: 'tank', id: 'tank-y', start: new THREE.Vector3() }, flat, DIFFICULTY_TABLE.normal, settings);
    tank.applyDamage(49);
    expect(tank.isAlive()).toBe(true);
    tank.applyDamage(1);
    expect(tank.isAlive()).toBe(false);
  });

  it('flak fires leading bursts only at an aircraft inside its range', () => {
    const fire = (playerPos: THREE.Vector3) => {
      const flak = new GroundUnit(new THREE.Scene(), { kind: 'flak', id: 'flak-x', start: new THREE.Vector3() }, flat, DIFFICULTY_TABLE.hard, settings);
      let shots = 0;
      let lastDir = new THREE.Vector3();
      for (let i = 0; i < 60 * 20; i++) {
        flak.update(1 / 60, playerPos, new THREE.Vector3(), true);
        if (flak.fireRequested) {
          shots += 1;
          lastDir = flak.fireDirection.clone();
        }
      }
      return { shots, lastDir };
    };
    const inRange = new THREE.Vector3(0, 500, -300);
    const result = fire(inRange);
    expect(result.shots).toBeGreaterThan(3);
    // Aimed at the aircraft, give or take the deliberate aiming error.
    const toPlayer = inRange.clone().sub(new THREE.Vector3(0, 12 + 2.6, 0)).normalize();
    expect(result.lastDir.dot(toPlayer)).toBeGreaterThan(0.995);

    expect(fire(new THREE.Vector3(0, FLAK_RANGE + 400, 0)).shots).toBe(0);
  });
});

describe('mainland terrain for the strike mission', () => {
  // Mirrors the definitions in Terrain.ts closely enough to check the layout is on dry, level ground.
  const p = WORLD_LAYOUT.armorPlateau;
  const field = new TerrainField(
    [{ cx: WORLD_LAYOUT.mainland.x, cz: WORLD_LAYOUT.mainland.z, radius: WORLD_LAYOUT.mainland.radius, amplitude: 96, seed: 113, ridgeFrequency: 3.1, ridgeWeight: 0.2 }],
    [{ cx: p.x, cz: p.z, radius: p.radius, height: p.height, falloff: 260 }],
  );

  it('puts the whole armour route and both flak positions on the level plateau', () => {
    const points = [WORLD_LAYOUT.armorRouteStart, WORLD_LAYOUT.armorRouteEnd, ...WORLD_LAYOUT.flakPositions];
    for (const pt of points) expect(field.heightAt(pt.x, pt.z)).toBe(p.height);
  });

  it('keeps the target area inside the mission boundary warning ring', () => {
    expect(Math.hypot(WORLD_LAYOUT.armorRouteStart.x, WORLD_LAYOUT.armorRouteStart.z)).toBeLessThan(7000);
  });
});

describe('strike mission scoring', () => {
  const base = {
    enemiesDestroyed: 0,
    radarDestroyed: false,
    cannonAccuracy: 0.5,
    missilesRemaining: 0,
    playerHealthFraction: 1,
    completionTimeSeconds: 600,
    landedSuccessfully: true,
    civilianStrikes: 0,
  };

  it('awards the same maximum for a full column as mission 1 does for fighters plus radar', () => {
    const strike = calculateScore({ ...base, primaryTargetFraction: 1 });
    const intercept = calculateScore({ ...base, enemiesDestroyed: 2, radarDestroyed: true });
    expect(strike.score).toBe(intercept.score);
  });

  it('scales with the fraction of tanks destroyed', () => {
    const half = calculateScore({ ...base, primaryTargetFraction: 0.5 });
    const none = calculateScore({ ...base, primaryTargetFraction: 0 });
    expect(half.score - none.score).toBe(1400);
  });
});
