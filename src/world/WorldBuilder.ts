import * as THREE from 'three';
import { Ocean } from './Ocean';
import { Terrain } from './Terrain';
import { Carrier } from '../entities/Carrier';

export interface WorldLayout {
  carrierStart: THREE.Vector3;
  carrierHeading: number;
  waypointAlpha: THREE.Vector3;
  waypointBravo: THREE.Vector3;
  enemySpawnA: THREE.Vector3;
  enemySpawnB: THREE.Vector3;
  radarSitePosition: THREE.Vector3;
}

export const WORLD_LAYOUT: WorldLayout = {
  carrierStart: new THREE.Vector3(0, 0, 0),
  carrierHeading: 90,
  waypointAlpha: new THREE.Vector3(1200, 380, -1650),
  waypointBravo: new THREE.Vector3(2084, 320, -2778),
  enemySpawnA: new THREE.Vector3(1750, 420, -2500),
  enemySpawnB: new THREE.Vector3(2050, 460, -2150),
  radarSitePosition: new THREE.Vector3(2084, 9.7, -2778),
};

/** Sets up scene lighting, sky, fog, and constructs the ocean + terrain world objects. */
export class WorldBuilder {
  ocean: Ocean;
  terrain: Terrain;
  carrier: Carrier;

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x8fc7de);
    scene.fog = new THREE.Fog(0x9fd0e0, 1400, 7600);

    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3b2a, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dd, 1.15);
    sun.position.set(-800, 900, 400);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(0x445566, 0.35);
    scene.add(ambient);

    this.ocean = new Ocean(scene);
    this.terrain = new Terrain(scene);
    this.carrier = new Carrier(scene, WORLD_LAYOUT.carrierStart.clone(), WORLD_LAYOUT.carrierHeading);
  }

  update(dt: number, elapsed: number) {
    this.ocean.update(dt);
    this.carrier.update(dt, elapsed);
  }

  getGroundHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }
}
