import * as THREE from 'three';

export interface WorldLayout {
  carrierStart: THREE.Vector3;
  carrierHeading: number;
  waypointAlpha: THREE.Vector3;
  waypointBravo: THREE.Vector3;
  enemySpawnA: THREE.Vector3;
  enemySpawnB: THREE.Vector3;
  /** X/Z are authoritative; Y is snapped to the sampled terrain height at world build time. */
  radarSitePosition: THREE.Vector3;

  // --- Mission 2 (Operation Iron Anvil): the western mainland ---
  /** Centre and radius of the mainland landmass. */
  mainland: { x: number; z: number; radius: number };
  /** Flattened inland plateau the armoured column crosses. */
  armorPlateau: { x: number; z: number; radius: number; height: number };
  /** Coast-crossing waypoint on the way in. */
  waypointCoast: THREE.Vector3;
  /** The column drives from routeStart to routeEnd (X/Z; Y is sampled from the terrain). */
  armorRouteStart: THREE.Vector3;
  armorRouteEnd: THREE.Vector3;
  /** Flak vehicle positions (X/Z; Y is sampled from the terrain). */
  flakPositions: THREE.Vector3[];
}

/**
 * Fixed mission geography. Kept in its own module so both the terrain generator and the world
 * builder can read it without a circular import.
 *
 * These positions are gameplay contract: the mission stages, tactical map and unit tests all
 * reference them, so they must not move during the visual refresh.
 */
export const WORLD_LAYOUT: WorldLayout = {
  carrierStart: new THREE.Vector3(0, 0, 0),
  carrierHeading: 90,
  waypointAlpha: new THREE.Vector3(1200, 380, -1650),
  waypointBravo: new THREE.Vector3(2084, 320, -2778),
  enemySpawnA: new THREE.Vector3(1750, 420, -2500),
  enemySpawnB: new THREE.Vector3(2050, 460, -2150),
  radarSitePosition: new THREE.Vector3(2084, 9.7, -2778),

  mainland: { x: -3900, z: -4300, radius: 1400 },
  armorPlateau: { x: -3900, z: -4300, radius: 330, height: 36 },
  waypointCoast: new THREE.Vector3(-2900, 450, -3200),
  armorRouteStart: new THREE.Vector3(-4160, 0, -4380),
  armorRouteEnd: new THREE.Vector3(-3640, 0, -4220),
  flakPositions: [new THREE.Vector3(-4010, 0, -4190), new THREE.Vector3(-3790, 0, -4420)],
};
