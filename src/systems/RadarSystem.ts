import * as THREE from 'three';
import { Targetable } from '../game/Types';
import { PlayerAircraft } from '../entities/PlayerAircraft';

export const RADAR_RANGE = 5200;
const LOCK_CONE_DEG = 32;
const LOCK_MAX_DISTANCE = 3200;
const LOCK_TIME = 1.3;
const TRACK_CONE_DEG = 55;
const TRACK_MAX_DISTANCE = 3800;

export interface RadarContact {
  target: Targetable;
  distance: number;
  bearingDeg: number; // relative to player heading, -180..180
  inLockCone: boolean;
}

/** Owns target cycling & radar-lock acquisition/maintenance for the player's weapons. */
export class RadarSystem {
  private lockHoldTimer = 0;

  getContactsInRange(player: PlayerAircraft, targets: Targetable[]): RadarContact[] {
    const playerPos = player.getPosition();
    const fwd = player.controller.flightModel.getForward();
    const contacts: RadarContact[] = [];
    for (const t of targets) {
      if (!t.isAlive() || t === (player as unknown as Targetable)) continue;
      const toTarget = t.getPosition().clone().sub(playerPos);
      const distance = toTarget.length();
      if (distance > RADAR_RANGE) continue;
      const dirNorm = toTarget.clone().normalize();
      const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(fwd.dot(dirNorm), -1, 1)));
      contacts.push({ target: t, distance, bearingDeg: angle, inLockCone: angle < LOCK_CONE_DEG && distance < LOCK_MAX_DISTANCE });
    }
    return contacts;
  }

  cycleTarget(player: PlayerAircraft, targets: Targetable[]) {
    const contacts = this.getContactsInRange(player, targets).sort((a, b) => a.distance - b.distance);
    if (contacts.length === 0) {
      player.currentTargetId = null;
      return;
    }
    const currentIdx = contacts.findIndex((c) => c.target.id === player.currentTargetId);
    const next = contacts[(currentIdx + 1) % contacts.length];
    player.currentTargetId = next.target.id;
    player.locked = false;
    player.lockProgress = 0;
    this.lockHoldTimer = 0;
  }

  update(dt: number, player: PlayerAircraft, targets: Targetable[], lockKeyHeld: boolean): { justAcquired: boolean } {
    let justAcquired = false;
    const current = targets.find((t) => t.id === player.currentTargetId) ?? null;
    if (!current || !current.isAlive()) {
      player.currentTargetId = null;
      player.locked = false;
      player.lockProgress = 0;
      this.lockHoldTimer = 0;
      return { justAcquired };
    }

    const playerPos = player.getPosition();
    const fwd = player.controller.flightModel.getForward();
    const toTarget = current.getPosition().clone().sub(playerPos);
    const distance = toTarget.length();
    const dirNorm = toTarget.clone().normalize();
    const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(fwd.dot(dirNorm), -1, 1)));

    const withinLockGeometry = angle < LOCK_CONE_DEG && distance < LOCK_MAX_DISTANCE;
    const withinTrackGeometry = angle < TRACK_CONE_DEG && distance < TRACK_MAX_DISTANCE;

    if (!player.locked) {
      if (lockKeyHeld && withinLockGeometry) {
        this.lockHoldTimer += dt;
        player.lockProgress = THREE.MathUtils.clamp(this.lockHoldTimer / LOCK_TIME, 0, 1);
        if (this.lockHoldTimer >= LOCK_TIME) {
          player.locked = true;
          justAcquired = true;
        }
      } else {
        this.lockHoldTimer = Math.max(0, this.lockHoldTimer - dt * 1.5);
        player.lockProgress = THREE.MathUtils.clamp(this.lockHoldTimer / LOCK_TIME, 0, 1);
      }
    } else {
      if (!withinTrackGeometry) {
        player.locked = false;
        player.lockProgress = 0;
        this.lockHoldTimer = 0;
      }
    }

    return { justAcquired };
  }
}
