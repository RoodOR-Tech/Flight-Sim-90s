import * as THREE from 'three';
import { Targetable } from '../game/Types';
import { PlayerAircraft } from '../entities/PlayerAircraft';

export const RADAR_RANGE = 5200;
const LOCK_CONE_DEG = 32;
const LOCK_MAX_DISTANCE = 3200;
const LOCK_TIME = 1.3;
const TRACK_CONE_DEG = 55;
const TRACK_MAX_DISTANCE = 3800;

interface RadarContact {
  target: Targetable;
  distance: number;
  angle: number;
  canAcquire: boolean;
}

export class RadarSystem {
  cue = '';
  private manualSelection: string | null = null;
  private offset = new THREE.Vector3();
  private forward = new THREE.Vector3();

  getContactsInRange(player: PlayerAircraft, targets: Targetable[]): RadarContact[] {
    const contacts: RadarContact[] = [];
    player.controller.flightModel.getForward(this.forward);
    for (const target of targets) {
      if (!target.isAlive() || target.team !== 'enemy') continue;
      this.offset.copy(target.getPosition()).sub(player.getPosition());
      const distance = this.offset.length();
      if (distance > RADAR_RANGE) continue;
      const angle = THREE.MathUtils.radToDeg(this.forward.angleTo(this.offset));
      contacts.push({ target, distance, angle, canAcquire: angle < LOCK_CONE_DEG && distance < LOCK_MAX_DISTANCE });
    }
    return contacts;
  }

  private select(player: PlayerAircraft, contact?: RadarContact) {
    player.currentTargetId = contact?.target.id ?? null;
    player.locked = false;
    player.lockProgress = 0;
  }

  cycleTarget(player: PlayerAircraft, targets: Targetable[]) {
    const contacts = this.getContactsInRange(player, targets).sort((a, b) => a.distance - b.distance);
    const currentIdx = contacts.findIndex((c) => c.target.id === player.currentTargetId);
    this.select(player, contacts.length ? contacts[(currentIdx + 1) % contacts.length] : undefined);
    this.manualSelection = player.currentTargetId;
  }

  update(dt: number, player: PlayerAircraft, targets: Targetable[], lockKeyHeld: boolean, assist = false) {
    const contacts = this.getContactsInRange(player, targets);
    let current = contacts.find((c) => c.target.id === player.currentTargetId);
    if (!current) this.manualSelection = null;
    if (assist && (!current || (!current.canAcquire && !player.locked && !this.manualSelection))) {
      const nearest = (a: RadarContact, b: RadarContact) => a.distance - b.distance;
      const eligible = contacts.filter((c) => c.canAcquire);
      current = eligible.sort(nearest)[0] ?? current ?? contacts.sort(nearest)[0];
    }
    if (!current || current.target.id !== player.currentTargetId) this.select(player, current);

    if (!current) {
      this.cue = contacts.length ? 'T  SELECT CONTACT' : 'SCANNING';
      return { justAcquired: false };
    }
    const wasLocked = player.locked;
    if (player.locked) {
      if (current.angle >= TRACK_CONE_DEG || current.distance >= TRACK_MAX_DISTANCE) {
        player.locked = false;
        player.lockProgress = 0;
      }
    } else {
      const acquiring = current.canAcquire && (assist || lockKeyHeld);
      const delta = (acquiring ? dt : -1.5 * dt) / LOCK_TIME;
      player.lockProgress = THREE.MathUtils.clamp(player.lockProgress + delta, 0, 1);
      player.locked = player.lockProgress >= 1;
    }
    if (player.locked) this.cue = 'LOCKED';
    else if (current.distance >= LOCK_MAX_DISTANCE) this.cue = 'OUT OF LOCK RANGE';
    else if (!current.canAcquire) this.cue = 'TURN TOWARD CONTACT';
    else if (!assist && !lockKeyHeld) this.cue = 'HOLD L TO LOCK';
    else this.cue = `LOCKING ${Math.round(player.lockProgress * 100)}%`;
    return { justAcquired: player.locked && !wasLocked };
  }
}
