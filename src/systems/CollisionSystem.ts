import * as THREE from 'three';
import { Terrain } from '../world/Terrain';
import { Carrier, CARRIER_LOCAL } from '../entities/Carrier';

export type CarrierContact = 'none' | 'deck' | 'hull';

const HULL_HALF = new THREE.Vector3(12, 4.5, 110);
const HULL_CENTER_LOCAL = new THREE.Vector3(0, -4, 0);
const ISLAND_HALF = new THREE.Vector3(4.5, 8, 17);
const ISLAND_CENTER_LOCAL = new THREE.Vector3(11, 9, -10);
export const DECK_X_HALF = 15.5;
export const DECK_Z_MIN = -108;
export const DECK_Z_MAX = 108;
/** Below this local height over the deck footprint the aircraft has struck the ship. */
export const DECK_Y_MIN = 0.9;
/**
 * Capture ceiling above the deck. Deliberately generous (the deck surface itself is at y = 1.5):
 * the landing is meant to be forgiving, so an aircraft settling anywhere in this band over the
 * arresting zone is treated as a touchdown rather than flying through untouched.
 */
export const DECK_Y_MAX = 9;

const invQuat = new THREE.Quaternion();
const localPos = new THREE.Vector3();

/** Physical-world collision checks: terrain, ocean surface, carrier structure, and aircraft-vs-aircraft. */
export class CollisionSystem {
  static terrainCrash(pos: THREE.Vector3, terrain: Terrain, radius: number): boolean {
    const groundH = terrain.getHeightAt(pos.x, pos.z);
    return pos.y <= groundH + radius * 0.4;
  }

  static oceanCrash(pos: THREE.Vector3): boolean {
    return pos.y <= 0.15;
  }

  /** Transforms pos into the carrier's local frame and classifies where it lies. */
  static carrierContact(pos: THREE.Vector3, carrier: Carrier): CarrierContact {
    invQuat.copy(carrier.group.quaternion).invert();
    localPos.copy(pos).sub(carrier.group.position).applyQuaternion(invQuat);

    const withinIsland =
      Math.abs(localPos.x - ISLAND_CENTER_LOCAL.x) < ISLAND_HALF.x &&
      Math.abs(localPos.y - ISLAND_CENTER_LOCAL.y) < ISLAND_HALF.y &&
      Math.abs(localPos.z - ISLAND_CENTER_LOCAL.z) < ISLAND_HALF.z;
    if (withinIsland) return 'hull';

    const withinHull =
      Math.abs(localPos.x - HULL_CENTER_LOCAL.x) < HULL_HALF.x &&
      Math.abs(localPos.y - HULL_CENTER_LOCAL.y) < HULL_HALF.y &&
      Math.abs(localPos.z - HULL_CENTER_LOCAL.z) < HULL_HALF.z;

    const withinDeckFootprint =
      Math.abs(localPos.x) < DECK_X_HALF && localPos.z > DECK_Z_MIN && localPos.z < DECK_Z_MAX;

    if (withinDeckFootprint && localPos.y >= DECK_Y_MIN && localPos.y <= DECK_Y_MAX) {
      return 'deck';
    }
    if (withinHull || (withinDeckFootprint && localPos.y < DECK_Y_MIN)) {
      return 'hull';
    }
    return 'none';
  }

  static localDeckPosition(pos: THREE.Vector3, carrier: Carrier): THREE.Vector3 {
    invQuat.copy(carrier.group.quaternion).invert();
    return pos.clone().sub(carrier.group.position).applyQuaternion(invQuat);
  }

  static aircraftCollision(posA: THREE.Vector3, radiusA: number, posB: THREE.Vector3, radiusB: number): boolean {
    return posA.distanceTo(posB) < radiusA + radiusB;
  }
}

export { CARRIER_LOCAL };
