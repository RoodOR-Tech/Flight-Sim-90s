import * as THREE from 'three';
import { Sky as SkyShader } from 'three/addons/objects/Sky.js';
import {
  FOG_COOL_COLOR,
  FOG_DENSITY,
  FOG_WARM_COLOR,
  HEMI_GROUND_COLOR,
  HEMI_LIGHT_BASE_INTENSITY,
  HEMI_LIGHT_GAIN,
  HEMI_SKY_COLOR,
  SKY_DOME_SCALE,
  SKY_MIE_COEFFICIENT,
  SKY_MIE_DIRECTIONAL_G,
  SKY_RAYLEIGH,
  SKY_TURBIDITY,
  SUN_AZIMUTH_DEG,
  SUN_ELEVATION_DEG,
  SUN_LIGHT_BASE_INTENSITY,
  SUN_LIGHT_GAIN,
} from '../rendering/RenderConstants';
import { GraphicsSettings } from '../rendering/GraphicsPresets';

const DEG2RAD = Math.PI / 180;

/**
 * Atmospheric sky, sun and haze.
 *
 * Pattern reference: OpenSkyFlight `js/atmosphere/AtmosphericSky.js` (MIT) — derive the sun vector
 * from elevation/azimuth via spherical coordinates, drive the directional and ambient light
 * intensity from a smooth `sin(elevNorm·π/2)` sun factor, and lerp the exponential fog colour from
 * a warm low-sun tone to a cool high-sun tone using pre-allocated Color objects to avoid GC churn.
 * Adapted to WebGL's classic `Sky.js` shader (OSF uses the WebGPU/TSL `SkyMesh`).
 */
export class Sky {
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  sunDirection = new THREE.Vector3();

  private sky: SkyShader;
  private warmColor = new THREE.Color(FOG_WARM_COLOR);
  private coolColor = new THREE.Color(FOG_COOL_COLOR);
  private fogColor = new THREE.Color();
  private sunFactor = 0;

  constructor(private scene: THREE.Scene, settings: GraphicsSettings) {
    this.sky = new SkyShader();
    this.sky.scale.setScalar(SKY_DOME_SCALE);
    // The sky dome must not be dimmed by scene fog, or the horizon flattens into a solid band.
    (this.sky.material as THREE.ShaderMaterial).fog = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 1);
    this.sunLight.castShadow = settings.shadowsEnabled;
    this.configureShadow(settings);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, 1);
    scene.add(this.hemiLight);

    this.update(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG);
  }

  private configureShadow(settings: GraphicsSettings) {
    const cam = this.sunLight.shadow.camera;
    // Tight bounds: the shadow volume only needs to cover the aircraft and its immediate
    // surroundings, which keeps the depth map sharp at a modest resolution.
    const extent = 140;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 900;
    this.sunLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.05;
    cam.updateProjectionMatrix();
  }

  applyQuality(settings: GraphicsSettings) {
    this.sunLight.castShadow = settings.shadowsEnabled;
    this.sunLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      // Null assignment forces Three to reallocate the shadow map at the new size.
      (this.sunLight.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  update(elevationDeg: number, azimuthDeg: number) {
    const phi = (90 - elevationDeg) * DEG2RAD;
    const theta = azimuthDeg * DEG2RAD;
    this.sunDirection.setFromSphericalCoords(1, phi, theta);

    const uniforms = (this.sky.material as THREE.ShaderMaterial).uniforms;
    uniforms.sunPosition.value.copy(this.sunDirection);
    uniforms.turbidity.value = SKY_TURBIDITY;
    uniforms.rayleigh.value = SKY_RAYLEIGH;
    uniforms.mieCoefficient.value = SKY_MIE_COEFFICIENT;
    uniforms.mieDirectionalG.value = SKY_MIE_DIRECTIONAL_G;

    // Smooth 0..1 ramp from horizon to zenith.
    const elevNorm = Math.max(0, elevationDeg) / 90;
    this.sunFactor = Math.sin((elevNorm * Math.PI) / 2);

    this.sunLight.position.copy(this.sunDirection).multiplyScalar(600);
    this.sunLight.intensity = SUN_LIGHT_BASE_INTENSITY + this.sunFactor * SUN_LIGHT_GAIN;
    this.hemiLight.intensity = HEMI_LIGHT_BASE_INTENSITY + this.sunFactor * HEMI_LIGHT_GAIN;

    // Warm haze near sunrise/sunset, cooler blue haze with a high sun.
    this.fogColor.copy(this.warmColor).lerp(this.coolColor, this.sunFactor);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = FOG_DENSITY;
    } else {
      this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), FOG_DENSITY);
    }
    // Background matches the haze so distant geometry dissolves instead of ending at a hard line.
    this.scene.background = null;
  }

  getFogColor(): THREE.Color {
    return this.fogColor;
  }

  getSunFactor(): number {
    return this.sunFactor;
  }

  /**
   * Keeps the sky dome and the shadow frustum centred on the player, so the shadow map stays
   * dense near the aircraft without needing a huge orthographic volume.
   */
  follow(target: THREE.Vector3) {
    this.sky.position.set(target.x, 0, target.z);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(600).add(target);
    this.sunLight.target.position.copy(target);
    this.sunLight.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.sky);
    (this.sky.material as THREE.Material).dispose();
    this.sky.geometry.dispose();
  }
}
