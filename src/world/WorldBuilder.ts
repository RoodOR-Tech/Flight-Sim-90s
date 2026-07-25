import * as THREE from 'three';
import { Ocean } from './Ocean';
import { Terrain } from './Terrain';
import { Sky } from './Sky';
import { Clouds } from './Clouds';
import { Carrier } from '../entities/Carrier';
import { GraphicsSettings } from '../rendering/GraphicsPresets';
import { SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG } from '../rendering/RenderConstants';
import { WORLD_LAYOUT, WorldLayout } from './WorldLayout';

export { WORLD_LAYOUT };
export type { WorldLayout };

/**
 * Owns the environment: atmosphere, ocean, clouds, terrain and the carrier.
 *
 * Construction order matters — the Sky installs scene fog and computes the sun direction, both of
 * which the Ocean and Clouds need at build time.
 */
export class WorldBuilder {
  sky: Sky;
  ocean: Ocean;
  terrain: Terrain;
  clouds: Clouds;
  carrier: Carrier;

  private elapsed = 0;

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.sky = new Sky(scene, settings);
    this.ocean = new Ocean(scene, settings, this.sky.sunDirection);
    this.clouds = new Clouds(scene, settings, this.sky.getFogColor());
    this.terrain = new Terrain(scene, settings);
    this.carrier = new Carrier(
      scene,
      WORLD_LAYOUT.carrierStart.clone(),
      WORLD_LAYOUT.carrierHeading,
      settings,
    );
  }

  /** Terrain height above sea level, or 0 over open water. */
  getGroundHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }

  /**
   * Height the camera must stay above at a given position — terrain where there is land,
   * sea level otherwise.
   */
  getSurfaceHeightAt(x: number, z: number): number {
    return Math.max(0, this.terrain.getHeightAt(x, z));
  }

  update(dt: number, cameraPosition: THREE.Vector3, playerPosition: THREE.Vector3) {
    this.elapsed += dt;
    this.sky.follow(playerPosition);
    this.ocean.update(dt, cameraPosition, this.sky.sunDirection);
    this.clouds.update(dt, cameraPosition);
    this.carrier.update(dt, this.elapsed);
  }

  applyQuality(settings: GraphicsSettings) {
    this.sky.applyQuality(settings);
    this.clouds.applyQuality(settings);
    this.terrain.applyQuality(settings);
    this.carrier.applyQuality(settings);
  }

  /** Reset per-mission animation state without rebuilding geometry. */
  resetForMission() {
    this.elapsed = 0;
    this.carrier.resetPosition(WORLD_LAYOUT.carrierStart.clone(), WORLD_LAYOUT.carrierHeading);
    this.sky.update(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG);
  }

  dispose() {
    this.sky.dispose();
    this.ocean.dispose();
    this.clouds.dispose();
    this.terrain.dispose();
  }
}
