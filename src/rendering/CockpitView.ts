import * as THREE from 'three';
import { getSoftParticleTexture } from './ProceduralTextures';

/**
 * A simplified 3D cockpit frame, parented to the camera so it stays fixed in view.
 *
 * Design decision: every part is a **flat quad at one fixed depth**. Geometry with depth this close
 * to the eye magnifies unpredictably — a box only 1 m deep passing beside the camera can swallow a
 * third of the screen. Laying the frame out on a single plane at `Z` means the on-screen coverage
 * of each piece is exactly known from the frustum half-extents below, so the frame reliably hugs
 * the screen edges and leaves the centre (reticle, pitch ladder, targets) completely clear.
 */

/** Depth the whole cockpit frame is laid out on. */
const Z = -0.95;
/** Visible half-extents at depth Z for a 62 deg vertical FOV at 16:9. */
const HALF_H = 0.57;
const HALF_W = 1.01;

function quad(
  width: number,
  height: number,
  x: number,
  y: number,
  material: THREE.Material,
  z = Z,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z);
  return mesh;
}

export class CockpitView {
  group = new THREE.Group();
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private panelLightMat: THREE.MeshBasicMaterial;
  private damageOverlay: THREE.Mesh;
  private vibrationPhase = 0;
  private basePosition = new THREE.Vector3(0, 0, 0);

  constructor(camera: THREE.PerspectiveCamera) {
    // Unlit materials: the cockpit interior should not flicker with the scene's sun angle, and
    // MeshBasic keeps it perfectly predictable under tone mapping.
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x171b1d });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x2a3033 });
    // Dim: a backlit instrument face, not a light source. Bright green here reads as a glowing slab.
    this.panelLightMat = new THREE.MeshBasicMaterial({ color: 0x0a2415 });
    this.disposables.push(frameMat, trimMat, this.panelLightMat);

    // --- Bottom: glare shield + instrument panel occupying the lowest ~22% of the view ---
    const panelHeight = HALF_H * 0.46;
    const panel = quad(HALF_W * 2, panelHeight, 0, -HALF_H + panelHeight / 2, frameMat);
    this.group.add(panel);

    // Trim line along the top of the glare shield.
    const trim = quad(HALF_W * 2, 0.012, 0, -HALF_H + panelHeight, trimMat);
    this.group.add(trim);

    // Three backlit displays, sitting low on the panel so only their upper edge is in view.
    for (const x of [-0.3, 0, 0.3]) {
      const mfd = quad(0.15, 0.05, x, -HALF_H + panelHeight * 0.34, this.panelLightMat, Z + 0.001);
      this.group.add(mfd);
    }

    // --- Side rails: narrow vertical strips at the extreme left/right edges ---
    const railWidth = HALF_W * 0.13;
    for (const side of [1, -1]) {
      const rail = quad(railWidth, HALF_H * 2, side * (HALF_W - railWidth / 2), 0, frameMat);
      this.group.add(rail);
      // Inner trim highlight so the rail edge is visible against a bright sky.
      const railTrim = quad(0.01, HALF_H * 2, side * (HALF_W - railWidth), 0, trimMat);
      this.group.add(railTrim);
    }

    // --- Top: windscreen bow along the upper edge ---
    const bowHeight = HALF_H * 0.14;
    const bow = quad(HALF_W * 2, bowHeight, 0, HALF_H - bowHeight / 2, frameMat);
    this.group.add(bow);
    const bowTrim = quad(HALF_W * 2, 0.01, 0, HALF_H - bowHeight, trimMat);
    this.group.add(bowTrim);

    // --- Corner gussets: small triangles softening the rail/bow junctions ---
    const gussetShape = new THREE.Shape();
    gussetShape.moveTo(0, 0);
    gussetShape.lineTo(HALF_W * 0.22, 0);
    gussetShape.lineTo(0, -HALF_H * 0.3);
    gussetShape.closePath();
    const gussetGeo = new THREE.ShapeGeometry(gussetShape);
    this.disposables.push(gussetGeo);
    for (const side of [1, -1]) {
      const gusset = new THREE.Mesh(gussetGeo, frameMat);
      gusset.position.set(side * (HALF_W - railWidth), HALF_H - bowHeight, Z);
      gusset.scale.x = side;
      this.group.add(gusset);
    }

    // --- Canopy reflection: a soft additive smudge, using the radial-gradient sprite texture so
    // it fades to nothing at the edges. A plain quad would show its own rectangle against the sky.
    const reflMat = new THREE.MeshBasicMaterial({
      map: getSoftParticleTexture(),
      color: 0xcfe6ff,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(reflMat);
    const reflection = quad(HALF_W * 1.1, HALF_H * 0.55, -HALF_W * 0.22, HALF_H * 0.4, reflMat, Z + 0.003);
    this.group.add(reflection);

    // --- Damage overlay: red tint that fades in only when badly hurt ---
    const dmgMat = new THREE.MeshBasicMaterial({
      color: 0x8a1f14,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.disposables.push(dmgMat);
    this.damageOverlay = quad(HALF_W * 2.2, HALF_H * 2.2, 0, 0, dmgMat, Z + 0.004);
    this.group.add(this.damageOverlay);

    // Track plane geometries for disposal, and keep the cockpit out of shadow/culling passes.
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.geometry instanceof THREE.PlaneGeometry) this.disposables.push(o.geometry);
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        // Draw the cockpit after the world so it always composites on top of distant geometry.
        o.renderOrder = 40;
      }
    });

    camera.add(this.group);
    this.group.visible = false;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /**
   * @param healthFraction 0..1 — drives the damage tint and instrument dimming.
   * @param vibration 0..1 — airframe buffet (afterburner, low-altitude turbulence, damage).
   */
  update(dt: number, healthFraction: number, vibration: number, reducedMotion: boolean) {
    if (!this.group.visible) return;

    const damage = 1 - healthFraction;
    // Only appears once genuinely damaged, so it never tints ordinary flight.
    (this.damageOverlay.material as THREE.MeshBasicMaterial).opacity = Math.max(0, damage - 0.6) * 0.35;

    // Instrument backlight dims, and flickers once badly hurt.
    const flicker = damage > 0.6 ? 0.55 + Math.random() * 0.45 : 1;
    const level = 0.35 + healthFraction * 0.65;
    this.panelLightMat.color.setRGB(0.035 * level * flicker, 0.14 * level * flicker, 0.08 * level * flicker);

    if (reducedMotion || vibration <= 0.001) {
      this.group.position.copy(this.basePosition);
      return;
    }

    // Small high-frequency shake applied to the cockpit rather than the camera, so the outside
    // world stays stable and the airframe feels like it is buffeting around the pilot.
    this.vibrationPhase += dt * 42;
    const amp = vibration * 0.0022;
    this.group.position.set(
      this.basePosition.x + Math.sin(this.vibrationPhase * 1.7) * amp,
      this.basePosition.y + Math.sin(this.vibrationPhase * 2.3) * amp,
      this.basePosition.z,
    );
  }

  dispose(camera: THREE.PerspectiveCamera) {
    camera.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
