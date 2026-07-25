import * as THREE from 'three';
import { getCloudSpriteTexture } from '../rendering/ProceduralTextures';
import { GraphicsSettings } from '../rendering/GraphicsPresets';
import { CLOUD_ALTITUDE, CLOUD_DRIFT_SPEED, CLOUD_FIELD_RADIUS } from '../rendering/RenderConstants';

interface CloudFormation {
  group: THREE.Group;
  driftX: number;
  driftZ: number;
  baseOpacity: number;
}

const SPRITE_VARIANTS = 4;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scattered cloud formations built from camera-facing sprite clusters.
 *
 * Each formation stacks several soft, irregular sprites at slightly different offsets and scales,
 * which reads as volume from a distance without any volumetric ray marching. Sprite textures are
 * procedurally generated with fully transparent borders so no rectangular sprite edge shows.
 * Formations drift slowly and fade with distance.
 */
export class Clouds {
  private formations: CloudFormation[] = [];
  private materials: THREE.SpriteMaterial[] = [];
  private group = new THREE.Group();
  private elapsed = 0;

  constructor(private scene: THREE.Scene, settings: GraphicsSettings, fogColor: THREE.Color) {
    this.group.renderOrder = 100;
    scene.add(this.group);

    for (let v = 0; v < SPRITE_VARIANTS; v++) {
      const mat = new THREE.SpriteMaterial({
        map: getCloudSpriteTexture(v),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        // Tint slightly toward the haze colour so clouds sit in the same atmosphere as the scene.
        color: new THREE.Color(0xffffff).lerp(fogColor, 0.18),
      });
      this.materials.push(mat);
    }

    this.build(settings.cloudCount);
  }

  private build(count: number) {
    const rand = mulberry32(9182);
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const angle = rand() * Math.PI * 2;
      const dist = 400 + rand() * CLOUD_FIELD_RADIUS;
      const altitude = CLOUD_ALTITUDE + (rand() - 0.5) * 340;
      group.position.set(Math.cos(angle) * dist, altitude, Math.sin(angle) * dist);

      const formationScale = 110 + rand() * 240;
      const puffs = 3 + Math.floor(rand() * 4);
      for (let p = 0; p < puffs; p++) {
        const mat = this.materials[Math.floor(rand() * SPRITE_VARIANTS)];
        const sprite = new THREE.Sprite(mat);
        const s = formationScale * (0.55 + rand() * 0.6);
        // Wider than tall, which is how fair-weather cumulus reads at distance.
        sprite.scale.set(s, s * (0.5 + rand() * 0.25), 1);
        sprite.position.set(
          (rand() - 0.5) * formationScale * 1.5,
          (rand() - 0.5) * formationScale * 0.28,
          (rand() - 0.5) * formationScale * 1.5,
        );
        group.add(sprite);
      }

      this.group.add(group);
      this.formations.push({
        group,
        driftX: (rand() - 0.5) * CLOUD_DRIFT_SPEED * 2,
        driftZ: (rand() - 0.5) * CLOUD_DRIFT_SPEED * 2,
        baseOpacity: 0.62 + rand() * 0.3,
      });
    }
  }

  /** Rebuilds the cloud field for a new quality preset. */
  applyQuality(settings: GraphicsSettings) {
    if (this.formations.length === settings.cloudCount) return;
    for (const f of this.formations) this.group.remove(f.group);
    this.formations = [];
    this.build(settings.cloudCount);
  }

  update(dt: number, cameraPosition: THREE.Vector3) {
    this.elapsed += dt;
    const wrapRadius = CLOUD_FIELD_RADIUS + 1200;

    for (const f of this.formations) {
      f.group.position.x += f.driftX * dt;
      f.group.position.z += f.driftZ * dt;

      // Wrap formations around the player so the sky always has clouds without growing the count.
      const dx = f.group.position.x - cameraPosition.x;
      const dz = f.group.position.z - cameraPosition.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > wrapRadius * wrapRadius) {
        const angle = Math.atan2(dz, dx) + Math.PI;
        const newDist = CLOUD_FIELD_RADIUS * 0.85;
        f.group.position.x = cameraPosition.x + Math.cos(angle) * newDist;
        f.group.position.z = cameraPosition.z + Math.sin(angle) * newDist;
      }
    }
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const mat of this.materials) mat.dispose();
    this.materials = [];
    this.formations = [];
  }
}
