import * as THREE from 'three';
import { IslandDefinition, PlateauDefinition, TerrainField } from './TerrainField';
import { GraphicsSettings } from '../rendering/GraphicsPresets';
import { getConcreteTexture, getRockTexture } from '../rendering/ProceduralTextures';
import { buildDecorativeBuilding, buildPatrolBoat } from '../game/AssetFactory';
import { WORLD_LAYOUT } from './WorldLayout';

export interface Landform {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface CivilianStructure {
  position: THREE.Vector3;
  radius: number;
}

const MAIN_ISLAND = { x: 2400, z: -3200, radius: 640 };
const RADAR_PLATEAU_HEIGHT = 42;

// Biome colours, blended per-vertex by elevation and slope.
const COLOR_SAND = new THREE.Color(0xcbb894);
const COLOR_SHORE_ROCK = new THREE.Color(0x8d8474);
const COLOR_GRASS = new THREE.Color(0x51603c);
const COLOR_GRASS_DRY = new THREE.Color(0x6d7043);
const COLOR_ROCK = new THREE.Color(0x6f6858);
const COLOR_ROCK_HIGH = new THREE.Color(0x8a8578);
// Dry open steppe for the mainland interior: much paler than the island's scrub, so vehicles and
// their shadows read clearly against it from attack altitude.
const COLOR_STEPPE = new THREE.Color(0xd9c992);

/**
 * The island area: one main landmass plus smaller outlying islands, generated from the
 * TerrainField height function and coloured per-vertex by elevation/slope biome rules.
 *
 * `getHeightAt` delegates to the same field used to build the mesh, so collision matches visuals.
 */
export class Terrain {
  field: TerrainField;
  landforms: Landform[] = [];
  civilianStructures: CivilianStructure[] = [];
  mainIslandCenter = new THREE.Vector3(MAIN_ISLAND.x, 0, MAIN_ISLAND.z);
  mainIslandRadius = MAIN_ISLAND.radius;
  /** Height the radar site sits at, sampled from the field so the model never floats or sinks. */
  radarPadHeight = RADAR_PLATEAU_HEIGHT;

  private meshes: THREE.Mesh[] = [];
  private props: THREE.Object3D[] = [];
  private terrainMaterial: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene, settings: GraphicsSettings) {
    const islands: IslandDefinition[] = [
      {
        cx: MAIN_ISLAND.x,
        cz: MAIN_ISLAND.z,
        radius: MAIN_ISLAND.radius,
        amplitude: 132,
        seed: 7,
        ridgeFrequency: 4.4,
        ridgeWeight: 0.55,
      },
    ];

    // Outlying rocky islets, deterministically placed around the combat area.
    const isletSpecs: Array<[number, number, number, number, number]> = [
      // [x, z, radius, amplitude, seed]
      [-1850, -1450, 120, 46, 31],
      [900, -4600, 165, 62, 47],
      [3550, -1750, 140, 54, 59],
      [-900, -3800, 95, 34, 71],
      [3900, -4100, 110, 44, 83],
      [1500, 900, 85, 28, 97],
    ];
    // The western mainland (mission 2): a much larger, gentler landmass of rolling hills.
    const mainland: IslandDefinition = {
      cx: WORLD_LAYOUT.mainland.x,
      cz: WORLD_LAYOUT.mainland.z,
      radius: WORLD_LAYOUT.mainland.radius,
      amplitude: 96,
      seed: 113,
      ridgeFrequency: 3.1,
      ridgeWeight: 0.2,
    };
    islands.push(mainland);

    for (const [x, z, radius, amplitude, seed] of isletSpecs) {
      islands.push({ cx: x, cz: z, radius, amplitude, seed, ridgeFrequency: 5.6, ridgeWeight: 0.68 });
    }

    // Flatten a pad for the radar station so the installation sits on level ground.
    const plateaus: PlateauDefinition[] = [
      {
        cx: WORLD_LAYOUT.radarSitePosition.x,
        cz: WORLD_LAYOUT.radarSitePosition.z,
        radius: 58,
        height: RADAR_PLATEAU_HEIGHT,
        falloff: 95,
      },
      // Level inland ground for the armoured column to drive across.
      {
        cx: WORLD_LAYOUT.armorPlateau.x,
        cz: WORLD_LAYOUT.armorPlateau.z,
        radius: WORLD_LAYOUT.armorPlateau.radius,
        height: WORLD_LAYOUT.armorPlateau.height,
        falloff: 260,
      },
    ];

    this.field = new TerrainField(islands, plateaus);
    this.radarPadHeight = this.field.heightAt(
      WORLD_LAYOUT.radarSitePosition.x,
      WORLD_LAYOUT.radarSitePosition.z,
    );

    for (const island of islands) {
      this.landforms.push({ x: island.cx, z: island.cz, radius: island.radius, height: island.amplitude });
    }

    const rockTexture = getRockTexture();
    rockTexture.repeat.set(28, 28);
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: rockTexture,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false,
    });

    for (const island of islands) {
      const isMain = island.radius === MAIN_ISLAND.radius;
      // The mainland is big enough to fly low over, so it gets full mesh density like the main island.
      const detailed = isMain || island === mainland;
      const segments = detailed ? settings.terrainSegments : Math.max(32, Math.floor(settings.terrainSegments * 0.35));
      const mesh = this.buildIslandMesh(island, segments, island === mainland ? COLOR_STEPPE : null);
      mesh.receiveShadow = settings.shadowsEnabled && isMain;
      this.meshes.push(mesh);
      scene.add(mesh);
    }

    this.buildProps(settings);
  }

  /**
   * Builds one island as a displaced grid. The grid extends slightly past the island radius so
   * the shoreline closes below sea level and no gap shows between land and water.
   */
  private buildIslandMesh(island: IslandDefinition, segments: number, tint: THREE.Color | null = null): THREE.Mesh {
    const extent = island.radius * 1.18;
    const size = extent * 2;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const localX = pos.getX(i);
      const localZ = pos.getZ(i);
      const worldX = localX + island.cx;
      const worldZ = localZ + island.cz;

      let h = this.field.heightAt(worldX, worldZ);
      // Push the outer skirt below the waterline so the island visually seats into the sea.
      if (h <= 0.02) h = -3.2;
      pos.setY(i, h);

      const slope = this.field.slopeAt(worldX, worldZ, 3);
      this.biomeColor(h, slope, color);
      // Above the beach, pull the biome colour most of the way toward the tint (if any).
      if (tint && h > 3.5) color.lerp(tint, 0.72);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.position.set(island.cx, 0, island.cz);
    return mesh;
  }

  /** Elevation + slope driven biome blend: sand → grass → rock → bare high rock. */
  private biomeColor(height: number, slopeRad: number, out: THREE.Color): THREE.Color {
    const slopeT = THREE.MathUtils.clamp(slopeRad / 0.95, 0, 1);

    if (height < 3.5) {
      // Beach / tidal shelf, turning rocky where the shore is steep.
      out.copy(COLOR_SAND).lerp(COLOR_SHORE_ROCK, slopeT);
      return out;
    }
    if (height < 34) {
      const t = (height - 3.5) / 30.5;
      out.copy(COLOR_SAND).lerp(COLOR_GRASS, THREE.MathUtils.smoothstep(t, 0, 1));
      // Steep faces stay bare rock even at low elevation.
      out.lerp(COLOR_ROCK, slopeT * 0.75);
      return out;
    }
    if (height < 82) {
      const t = (height - 34) / 48;
      out.copy(COLOR_GRASS).lerp(COLOR_GRASS_DRY, t);
      out.lerp(COLOR_ROCK, Math.max(t * 0.55, slopeT * 0.85));
      return out;
    }
    const t = THREE.MathUtils.clamp((height - 82) / 50, 0, 1);
    out.copy(COLOR_ROCK).lerp(COLOR_ROCK_HIGH, t);
    return out;
  }

  /** Places the coastal settlement, radio tower, patrol boat and distant escorts. */
  private buildProps(settings: GraphicsSettings) {
    const concrete = getConcreteTexture();
    void concrete;

    // Civilian settlement on a gentler stretch of coast, east of the radar pad.
    const settlement: Array<{ kind: 'hut' | 'warehouse' | 'tower'; x: number; z: number; radius: number }> = [
      { kind: 'warehouse', x: MAIN_ISLAND.x + 230, z: MAIN_ISLAND.z + 300, radius: 10 },
      { kind: 'hut', x: MAIN_ISLAND.x + 296, z: MAIN_ISLAND.z + 254, radius: 4 },
      { kind: 'hut', x: MAIN_ISLAND.x + 186, z: MAIN_ISLAND.z + 352, radius: 4 },
      { kind: 'hut', x: MAIN_ISLAND.x + 258, z: MAIN_ISLAND.z + 372, radius: 4 },
      { kind: 'tower', x: MAIN_ISLAND.x + 350, z: MAIN_ISLAND.z + 226, radius: 3 },
    ];

    for (const s of settlement) {
      const building = buildDecorativeBuilding(s.kind);
      const groundY = this.field.heightAt(s.x, s.z);
      building.position.set(s.x, groundY, s.z);
      // Face buildings roughly downhill so they read as sited on the terrain.
      const n = this.field.normalAt(s.x, s.z, 4);
      building.rotation.y = Math.atan2(n.x, n.z);
      building.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = settings.shadowsEnabled;
      });
      this.scene.add(building);
      this.props.push(building);
      this.civilianStructures.push({
        position: new THREE.Vector3(s.x, groundY + 2, s.z),
        radius: s.radius,
      });
    }

    // Civilian patrol boat offshore.
    const boat = buildPatrolBoat();
    boat.position.set(MAIN_ISLAND.x - 620, 0.9, MAIN_ISLAND.z + 640);
    boat.rotation.y = 1.15;
    this.scene.add(boat);
    this.props.push(boat);
    this.civilianStructures.push({ position: boat.position.clone(), radius: 7 });

    // Distant task-group escorts (decorative silhouettes).
    for (const [x, z, rot] of [
      [980, 430, 0.2],
      [-760, 560, -0.35],
    ] as Array<[number, number, number]>) {
      const escort = buildPatrolBoat();
      escort.scale.setScalar(2.3);
      escort.position.set(x, 1.4, z);
      escort.rotation.y = rot;
      this.scene.add(escort);
      this.props.push(escort);
    }
  }

  /** Height query used by collision and prop placement — same field that built the mesh. */
  getHeightAt(x: number, z: number): number {
    return Math.max(0, this.field.heightAt(x, z));
  }

  applyQuality(settings: GraphicsSettings) {
    // Only the main island (the largest mesh) receives shadows; islets are too far to matter.
    const mainMesh = this.meshes[0];
    for (const mesh of this.meshes) {
      mesh.receiveShadow = settings.shadowsEnabled && mesh === mainMesh;
    }
    for (const prop of this.props) {
      prop.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = settings.shadowsEnabled;
      });
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
    for (const prop of this.props) this.scene.remove(prop);
    this.props = [];
    this.terrainMaterial.dispose();
  }
}
