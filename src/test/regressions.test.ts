import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { CombatSystem, CombatContext } from '../systems/CombatSystem';
import { GameState } from '../game/GameState';

function makeContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const player = {
    id: 'player',
    isAlive: () => true,
    getPosition: () => new THREE.Vector3(0, 5000, 0),
    getCollisionRadius: () => 3,
    applyDamage: vi.fn(),
  };
  const effects = { smokePuff: vi.fn(), explosion: vi.fn(), notifyDamage: vi.fn() };
  return {
    scene: new THREE.Scene(),
    player: player as unknown as CombatContext['player'],
    hostileTargets: [],
    civilianStructures: [],
    effects: effects as unknown as CombatContext['effects'],
    audio: { explosion: vi.fn() } as unknown as CombatContext['audio'],
    ...overrides,
  };
}

describe('terrain stops weapons', () => {
  it('removes a cannon round that passes below the terrain surface', () => {
    const combat = new CombatSystem();
    const ctx = makeContext({ terrainHeightAt: () => 100 });
    combat.fireCannon(ctx.scene, new THREE.Vector3(0, 101, 0), new THREE.Vector3(0, -1, 0), 'player');
    combat.update(1 / 60, ctx);
    expect(combat.projectiles.length).toBe(0);
  });

  it('keeps a round flying above the terrain', () => {
    const combat = new CombatSystem();
    const ctx = makeContext({ terrainHeightAt: () => 100 });
    combat.fireCannon(ctx.scene, new THREE.Vector3(0, 300, 0), new THREE.Vector3(0, 0, -1), 'player');
    combat.update(1 / 60, ctx);
    expect(combat.projectiles.length).toBe(1);
  });

  it('detonates a missile that flies into a hillside without damaging its target', () => {
    const combat = new CombatSystem();
    const ctx = makeContext({ terrainHeightAt: () => 100 });
    const target = {
      id: 't',
      isAlive: () => true,
      getPosition: () => new THREE.Vector3(0, 300, -5000),
      getCollisionRadius: () => 3,
      applyDamage: vi.fn(),
    };
    const effects = ctx.effects;
    combat.fireMissile(
      ctx.scene,
      new THREE.Vector3(0, 101, 0),
      new THREE.Vector3(0, -1, 0),
      target as unknown as Parameters<CombatSystem['fireMissile']>[3],
      'player',
      effects,
    );
    combat.update(1 / 60, ctx);
    expect(combat.missiles.length).toBe(0);
    expect(target.applyDamage).not.toHaveBeenCalled();
  });
});

describe('GameState persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  it('round-trips settings and best score', () => {
    const a = new GameState();
    a.settings.difficulty = 'hard';
    a.settings.muted = true;
    a.sessionBest = { score: 4200, grade: 'A' };
    a.saveSettings();
    a.saveBest();

    const b = new GameState();
    expect(b.settings.difficulty).toBe('hard');
    expect(b.settings.muted).toBe(true);
    expect(b.sessionBest).toEqual({ score: 4200, grade: 'A' });
  });

  it('ignores corrupt or wrongly typed stored values', () => {
    store.set('obb.settings.v1', JSON.stringify({ difficulty: 'insane', muted: 'yes', bogus: 1 }));
    store.set('obb.best.v1', '{not json');
    const s = new GameState();
    expect(s.settings.difficulty).toBe('normal');
    expect(s.settings.muted).toBe(false);
    expect('bogus' in s.settings).toBe(false);
    expect(s.sessionBest).toBeNull();
  });
});
