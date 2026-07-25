import * as THREE from 'three';
import { Projectile, ProjectileOwner, segmentHitsSphere } from '../entities/Projectile';
import { Missile, MissileOwner } from '../entities/Missile';
import { Targetable } from '../game/Types';
import { PlayerAircraft } from '../entities/PlayerAircraft';
import { EffectsSystem } from './EffectsSystem';
import { AudioManager } from '../game/AudioManager';
import { CivilianStructure } from '../world/Terrain';

const CANNON_DAMAGE = 6;
const MISSILE_DAMAGE = 55;
const CANNON_SPREAD = 0.012;

export interface CombatEvent {
  type: 'kill' | 'civilian-hit' | 'player-hit' | 'target-destroyed';
  targetId?: string;
}

export interface CombatContext {
  scene: THREE.Scene;
  player: PlayerAircraft;
  hostileTargets: Targetable[];
  civilianStructures: CivilianStructure[];
  effects: EffectsSystem;
  audio: AudioManager;
}

export class CombatSystem {
  projectiles: Projectile[] = [];
  missiles: Missile[] = [];
  private shotsFiredByPlayer = 0;
  private shotsHitByPlayer = 0;

  getAccuracy(): number {
    if (this.shotsFiredByPlayer === 0) return 1;
    return this.shotsHitByPlayer / this.shotsFiredByPlayer;
  }

  fireCannon(scene: THREE.Scene, origin: THREE.Vector3, dir: THREE.Vector3, owner: ProjectileOwner) {
    this.projectiles.push(new Projectile(scene, origin, dir, CANNON_SPREAD, owner));
    if (owner === 'player') this.shotsFiredByPlayer += 1;
  }

  fireMissile(scene: THREE.Scene, origin: THREE.Vector3, dir: THREE.Vector3, target: Targetable | null, owner: MissileOwner, effects: EffectsSystem) {
    const missile = new Missile(scene, origin, dir, target, owner);
    missile.onSmoke = (pos) => effects.smokePuff(pos, 1.4);
    this.missiles.push(missile);
  }

  update(dt: number, ctx: CombatContext): CombatEvent[] {
    const events: CombatEvent[] = [];
    const { scene, player, hostileTargets, civilianStructures, effects, audio } = ctx;

    // --- Projectiles ---
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.update(dt);
      if (!p.alive) continue;

      if (p.owner === 'player') {
        for (const t of hostileTargets) {
          if (!t.isAlive()) continue;
          if (segmentHitsSphere(p.previousPosition, p.position, t.getPosition(), t.getCollisionRadius())) {
            const wasAlive = t.isAlive();
            t.applyDamage(CANNON_DAMAGE, p.velocity.clone().normalize());
            this.shotsHitByPlayer += 1;
            effects.smokePuff(p.position, 0.8);
            p.alive = false;
            if (wasAlive && !t.isAlive()) {
              events.push({ type: 'target-destroyed', targetId: t.id });
              effects.explosion(t.getPosition(), t.kind === 'ground' ? 2 : 1.4);
              audio.explosion();
            }
            break;
          }
        }
        if (p.alive) {
          for (const c of civilianStructures) {
            if (segmentHitsSphere(p.previousPosition, p.position, c.position, c.radius)) {
              events.push({ type: 'civilian-hit' });
              effects.smokePuff(p.position, 1.2);
              p.alive = false;
              break;
            }
          }
        }
      } else if (p.owner === 'enemy' && player.isAlive()) {
        if (segmentHitsSphere(p.previousPosition, p.position, player.getPosition(), player.getCollisionRadius())) {
          player.applyDamage(CANNON_DAMAGE);
          effects.notifyDamage(p.velocity.clone().normalize());
          events.push({ type: 'player-hit' });
          p.alive = false;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (!p.alive) p.dispose(scene);
      return p.alive;
    });

    // --- Missiles ---
    for (const m of this.missiles) {
      if (!m.alive && !m.exploded) continue;
      if (m.alive) m.update(dt);
      if (m.exploded) {
        effects.explosion(m.position, m.hitTarget ? 1.6 : 1.0);
        audio.explosion();
        if (m.hitTarget && m.target) {
          const wasAlive = m.target.isAlive();
          m.target.applyDamage(MISSILE_DAMAGE, m.velocity.clone().normalize());
          if (m.owner === 'enemy' && m.target.id === player.id) {
            effects.notifyDamage(m.velocity.clone().normalize());
            events.push({ type: 'player-hit' });
          }
          if (wasAlive && !m.target.isAlive()) {
            events.push({ type: 'target-destroyed', targetId: m.target.id });
          }
        }
      }
    }
    for (const m of this.missiles) {
      if (m.exploded) m.dispose(scene);
    }
    this.missiles = this.missiles.filter((m) => !m.exploded);

    return events;
  }

  reset(scene: THREE.Scene) {
    for (const p of this.projectiles) p.dispose(scene);
    for (const m of this.missiles) m.dispose(scene);
    this.projectiles = [];
    this.missiles = [];
    this.shotsFiredByPlayer = 0;
    this.shotsHitByPlayer = 0;
  }
}
