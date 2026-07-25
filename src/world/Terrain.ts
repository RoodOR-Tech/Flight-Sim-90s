import * as THREE from 'three';
import {
  buildRockyIsland,
  buildHillCluster,
  buildCloud,
  buildDecorativeBuilding,
  buildPatrolBoat,
  mulberry32,
} from '../game/AssetFactory';

export interface Landform {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** Builds the island area: one main landmass with hills, several small rocky islands, clouds,
 * and simple decorative props. Also exposes a cheap cone-falloff height field used for collision. */
export interface CivilianStructure {
  position: THREE.Vector3;
  radius: number;
}

export class Terrain {
  landforms: Landform[] = [];
  civilianStructures: CivilianStructure[] = [];
  mainIslandCenter = new THREE.Vector3(2400, 0, -3200);
  mainIslandRadius = 620;

  constructor(scene: THREE.Scene) {
    // Main island
    const mainIsland = buildRockyIsland(this.mainIslandRadius, 70, 7);
    mainIsland.position.set(this.mainIslandCenter.x, 0, this.mainIslandCenter.z);
    mainIsland.scale.set(1, 1, 1);
    scene.add(mainIsland);
    this.landforms.push({ x: this.mainIslandCenter.x, z: this.mainIslandCenter.z, radius: this.mainIslandRadius, height: 65 });

    const hills = buildHillCluster(11);
    hills.position.set(this.mainIslandCenter.x - 120, 0, this.mainIslandCenter.z + 80);
    scene.add(hills);
    this.landforms.push({ x: this.mainIslandCenter.x - 120, z: this.mainIslandCenter.z + 80, radius: 130, height: 40 });

    // Decorative buildings & radio tower on the main island
    const warehouse = buildDecorativeBuilding('warehouse');
    warehouse.position.set(this.mainIslandCenter.x + 200, 4, this.mainIslandCenter.z + 250);
    scene.add(warehouse);
    this.civilianStructures.push({ position: warehouse.position.clone(), radius: 10 });

    const hut1 = buildDecorativeBuilding('hut');
    hut1.position.set(this.mainIslandCenter.x + 260, 4, this.mainIslandCenter.z + 210);
    scene.add(hut1);
    this.civilianStructures.push({ position: hut1.position.clone(), radius: 4 });
    const hut2 = buildDecorativeBuilding('hut');
    hut2.position.set(this.mainIslandCenter.x + 150, 4, this.mainIslandCenter.z + 300);
    scene.add(hut2);
    this.civilianStructures.push({ position: hut2.position.clone(), radius: 4 });

    const tower = buildDecorativeBuilding('tower');
    tower.position.set(this.mainIslandCenter.x + 320, 4, this.mainIslandCenter.z + 180);
    scene.add(tower);
    this.civilianStructures.push({ position: tower.position.clone(), radius: 3 });

    // A few small rocky islands scattered around the combat area
    const rand = mulberry32(42);
    for (let i = 0; i < 6; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 1400 + rand() * 3400;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist - 900;
      const radius = 35 + rand() * 90;
      const height = 15 + rand() * 45;
      const island = buildRockyIsland(radius, height, 100 + i);
      island.position.set(x, 0, z);
      scene.add(island);
      this.landforms.push({ x, z, radius, height });
    }

    // Small patrol boat near the island shoreline, purely decorative
    const boat = buildPatrolBoat();
    boat.position.set(this.mainIslandCenter.x - 500, 1.2, this.mainIslandCenter.z + 600);
    boat.rotation.y = 1.2;
    scene.add(boat);
    this.civilianStructures.push({ position: boat.position.clone(), radius: 7 });

    // Distant carrier task group escorts (decorative silhouettes only)
    const escort1 = buildPatrolBoat();
    escort1.scale.set(2.2, 2.2, 2.2);
    escort1.position.set(900, 1.5, 400);
    scene.add(escort1);
    const escort2 = buildPatrolBoat();
    escort2.scale.set(2.2, 2.2, 2.2);
    escort2.position.set(-700, 1.5, 500);
    scene.add(escort2);

    // Clouds
    const cloudRand = mulberry32(777);
    for (let i = 0; i < 14; i++) {
      const cloud = buildCloud(500 + i);
      const angle = cloudRand() * Math.PI * 2;
      const dist = cloudRand() * 6000;
      cloud.position.set(Math.cos(angle) * dist, 260 + cloudRand() * 260, Math.sin(angle) * dist);
      scene.add(cloud);
    }
  }

  /** Approximate ground height at (x,z) using a cone falloff per landform - cheap and good enough for arcade collision. */
  getHeightAt(x: number, z: number): number {
    let maxHeight = 0;
    for (const lf of this.landforms) {
      const dist = Math.hypot(x - lf.x, z - lf.z);
      if (dist < lf.radius) {
        const h = lf.height * (1 - dist / lf.radius);
        if (h > maxHeight) maxHeight = h;
      }
    }
    return maxHeight;
  }
}
