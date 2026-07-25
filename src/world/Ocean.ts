import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { getWaterNormalTexture } from '../rendering/ProceduralTextures';
import { GraphicsSettings } from '../rendering/GraphicsPresets';
import {
  OCEAN_COLOR,
  OCEAN_DEEP_COLOR,
  OCEAN_SIZE,
  OCEAN_WAVE_SCALE,
  OCEAN_WAVE_SPEED,
} from '../rendering/RenderConstants';

/**
 * Ocean surface.
 *
 * High/medium quality uses Three's `Water` addon (planar reflection + animated normal distortion),
 * fed by a procedurally generated normal map so no third-party texture is needed. Low quality
 * falls back to a cheap animated MeshStandardMaterial plane with no reflection pass.
 *
 * Sea level stays a flat plane at y=0 for gameplay purposes; all displacement is visual.
 */
export class Ocean {
  mesh: THREE.Mesh;
  private water: Water | null = null;
  private fallbackMaterial: THREE.MeshStandardMaterial | null = null;
  private normalTexture: THREE.DataTexture;
  private elapsed = 0;

  constructor(private scene: THREE.Scene, settings: GraphicsSettings, sunDirection: THREE.Vector3) {
    this.normalTexture = getWaterNormalTexture(256);

    if (settings.reflectiveWater) {
      const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 1, 1);
      this.water = new Water(geometry, {
        textureWidth: settings.waterReflectionResolution,
        textureHeight: settings.waterReflectionResolution,
        waterNormals: this.normalTexture,
        sunDirection: sunDirection.clone(),
        sunColor: 0xfff0d8,
        waterColor: OCEAN_COLOR,
        distortionScale: OCEAN_WAVE_SCALE,
        fog: scene.fog !== null && scene.fog !== undefined,
      });
      this.water.rotation.x = -Math.PI / 2;
      this.mesh = this.water as unknown as THREE.Mesh;
    } else {
      this.mesh = this.buildFallback();
    }

    this.mesh.position.y = 0;
    this.mesh.receiveShadow = false;
    // Render the ocean before transparent effects so splashes composite correctly.
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  private buildFallback(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const normalMap = this.normalTexture.clone();
    normalMap.needsUpdate = true;
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(220, 220);
    this.fallbackMaterial = new THREE.MeshStandardMaterial({
      color: OCEAN_COLOR,
      roughness: 0.32,
      metalness: 0.06,
      normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    return new THREE.Mesh(geometry, this.fallbackMaterial);
  }

  /** True when this instance is using the reflective Water shader rather than the cheap fallback. */
  isReflective(): boolean {
    return this.water !== null;
  }

  update(dt: number, cameraPosition: THREE.Vector3, sunDirection: THREE.Vector3) {
    this.elapsed += dt;

    // Keep the finite ocean plane centred under the camera so the player never reaches its edge.
    // Water.js samples its noise from world-space position, so the wave pattern stays anchored
    // and does not slide along with the plane.
    this.mesh.position.x = cameraPosition.x;
    this.mesh.position.z = cameraPosition.z;

    if (this.water) {
      const uniforms = this.water.material.uniforms as Record<string, THREE.IUniform>;
      uniforms.time.value += dt * OCEAN_WAVE_SPEED;
      (uniforms.sunDirection.value as THREE.Vector3).copy(sunDirection).normalize();
    } else if (this.fallbackMaterial?.normalMap) {
      // Scroll the normal map in world space to fake motion without a reflection pass.
      const map = this.fallbackMaterial.normalMap;
      map.offset.set(
        (cameraPosition.x / OCEAN_SIZE) * 220 + this.elapsed * 0.012,
        (cameraPosition.z / OCEAN_SIZE) * 220 + this.elapsed * 0.008,
      );
    }
  }

  /** Sea level is flat for gameplay/collision; visual displacement is cosmetic only. */
  getHeightAt(_x: number, _z: number): number {
    return 0;
  }

  getDeepColor(): number {
    return OCEAN_DEEP_COLOR;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry?.dispose();
    if (this.water) {
      (this.water.material as THREE.Material).dispose();
    }
    this.fallbackMaterial?.dispose();
  }
}
