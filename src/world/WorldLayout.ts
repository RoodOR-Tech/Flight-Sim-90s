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
};
