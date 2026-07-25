import * as THREE from 'three';
import { getSoftParticleTexture } from '../rendering/ProceduralTextures';
import { GraphicsSettings } from '../rendering/GraphicsPresets';

type ParticleKind = 'additive' | 'smoke';

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
  growth: number;
  startSize: number;
  startOpacity: number;
  /** Per-second velocity damping factor. */
  drag: number;
  /** Upward buoyancy applied to smoke. */
  buoyancy: number;
  spin: number;
  colorFrom: THREE.Color;
  colorTo: THREE.Color;
}

interface Debris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

const MAX_PARTICLES = 320;
const MAX_DEBRIS = 28;
const GRAVITY = 9.81;

/**
 * Pooled particle, debris and screen-shake effects.
 *
 * Two sprite materials are shared by all particles: an additive one for fire/flash/tracer impacts
 * and an alpha-blended one for smoke. Sprites are recycled from a fixed pool, and every effect
 * scales its particle count by the active quality preset, so the worst case is bounded.
 */
export class EffectsSystem {
  private pool: Particle[] = [];
  private debrisPool: Debris[] = [];
  private additiveMaterial: THREE.SpriteMaterial;
  private smokeMaterial: THREE.SpriteMaterial;
  private debrisMaterial: THREE.MeshStandardMaterial;

  shakeAmount = 0;
  lastDamageDirection: THREE.Vector3 | null = null;
  damageFlashTimer = 0;

  private particleScale: number;
  private activeCount = 0;
  private tmpColor = new THREE.Color();

  constructor(private scene: THREE.Scene, settings: GraphicsSettings) {
    this.particleScale = settings.particleScale;
    const tex = getSoftParticleTexture();

    this.additiveMaterial = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.smokeMaterial = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    this.debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2724,
      roughness: 0.9,
      metalness: 0.2,
    });

    const poolSize = Math.round(MAX_PARTICLES * Math.max(0.4, settings.particleScale));
    for (let i = 0; i < poolSize; i++) {
      // Each sprite needs its own material instance so opacity/colour can differ per particle.
      const sprite = new THREE.Sprite(this.additiveMaterial.clone());
      sprite.visible = false;
      sprite.renderOrder = 20;
      scene.add(sprite);
      this.pool.push({
        sprite,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        active: false,
        growth: 0,
        startSize: 1,
        startOpacity: 1,
        drag: 0,
        buoyancy: 0,
        spin: 0,
        colorFrom: new THREE.Color(0xffffff),
        colorTo: new THREE.Color(0xffffff),
      });
    }

    const debrisGeo = new THREE.BoxGeometry(0.5, 0.32, 0.7);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const mesh = new THREE.Mesh(debrisGeo, this.debrisMaterial);
      mesh.visible = false;
      scene.add(mesh);
      this.debrisPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        angular: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        active: false,
      });
    }
  }

  applyQuality(settings: GraphicsSettings) {
    this.particleScale = settings.particleScale;
  }

  getActiveParticleCount(): number {
    return this.activeCount;
  }

  private spawn(opts: {
    position: THREE.Vector3;
    kind: ParticleKind;
    colorFrom: number;
    colorTo: number;
    size: number;
    life: number;
    velocity: THREE.Vector3;
    growth: number;
    opacity?: number;
    drag?: number;
    buoyancy?: number;
    spin?: number;
  }): Particle | null {
    const p = this.pool.find((x) => !x.active);
    if (!p) return null; // pool exhausted — drop the particle rather than growing unbounded

    p.active = true;
    p.life = opts.life;
    p.maxLife = opts.life;
    p.velocity.copy(opts.velocity);
    p.growth = opts.growth;
    p.startSize = opts.size;
    p.startOpacity = opts.opacity ?? 1;
    p.drag = opts.drag ?? 0;
    p.buoyancy = opts.buoyancy ?? 0;
    p.spin = opts.spin ?? 0;
    p.colorFrom.setHex(opts.colorFrom);
    p.colorTo.setHex(opts.colorTo);

    const mat = p.sprite.material as THREE.SpriteMaterial;
    mat.blending = opts.kind === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.color.copy(p.colorFrom);
    mat.opacity = p.startOpacity;
    mat.needsUpdate = true;

    p.sprite.visible = true;
    p.sprite.position.copy(opts.position);
    p.sprite.scale.set(opts.size, opts.size, 1);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    return p;
  }

  private scaled(count: number): number {
    return Math.max(1, Math.round(count * this.particleScale));
  }

  /**
   * Layered explosion: a bright core flash, expanding fire, dark rolling smoke, and debris.
   * `scale` is roughly the radius in metres of the visible fireball.
   */
  explosion(position: THREE.Vector3, scale = 1, withDebris = true) {
    // 1. Instantaneous white-hot flash
    this.spawn({
      position: position.clone(),
      kind: 'additive',
      colorFrom: 0xffffff,
      colorTo: 0xffd08a,
      size: 5 * scale,
      life: 0.1,
      velocity: new THREE.Vector3(),
      growth: 26 * scale,
      opacity: 1,
    });

    // 2. Expanding fireball, cooling from yellow to deep red
    const fireCount = this.scaled(5);
    for (let i = 0; i < fireCount; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.3,
        (Math.random() - 0.5) * 2,
      ).multiplyScalar(6 * scale);
      this.spawn({
        position: position.clone(),
        kind: 'additive',
        colorFrom: 0xffc247,
        colorTo: 0x8c1b0a,
        size: 3.4 * scale,
        life: 0.5 + Math.random() * 0.35,
        velocity: dir,
        growth: 9 * scale,
        opacity: 0.95,
        drag: 2.4,
      });
    }

    // 3. Dark smoke that lingers and rises
    const smokeCount = this.scaled(7);
    for (let i = 0; i < smokeCount; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 8,
      );
      this.spawn({
        position: position.clone(),
        kind: 'smoke',
        colorFrom: 0x4a4340,
        colorTo: 0x9c9691,
        size: 3 * scale,
        life: 1.8 + Math.random() * 1.4,
        velocity: dir,
        growth: 7 * scale,
        opacity: 0.72,
        drag: 1.1,
        buoyancy: 2.6,
        spin: (Math.random() - 0.5) * 1.2,
      });
    }

    if (withDebris) this.spawnDebris(position, scale);
    this.addShake(0.85 * scale);
  }

  private spawnDebris(position: THREE.Vector3, scale: number) {
    const count = Math.min(this.scaled(5), MAX_DEBRIS);
    for (let i = 0; i < count; i++) {
      const d = this.debrisPool.find((x) => !x.active);
      if (!d) break;
      d.active = true;
      d.life = 2.2 + Math.random() * 1.6;
      d.maxLife = d.life;
      d.mesh.visible = true;
      d.mesh.position.copy(position);
      d.mesh.scale.setScalar(0.5 + Math.random() * scale);
      d.velocity.set(
        (Math.random() - 0.5) * 22,
        4 + Math.random() * 14,
        (Math.random() - 0.5) * 22,
      );
      d.angular.set(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
      );
    }
  }

  /** Missile motor trail puff. */
  missileTrail(position: THREE.Vector3) {
    this.spawn({
      position,
      kind: 'smoke',
      colorFrom: 0xe8e4de,
      colorTo: 0x8f8a85,
      size: 1.1,
      life: 1.5,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.5, (Math.random() - 0.5) * 1.2),
      growth: 3.6,
      opacity: 0.6,
      buoyancy: 0.6,
      drag: 0.8,
    });
    // A brief hot core right at the nozzle.
    this.spawn({
      position: position.clone(),
      kind: 'additive',
      colorFrom: 0xffb457,
      colorTo: 0xff6a1e,
      size: 0.85,
      life: 0.16,
      velocity: new THREE.Vector3(),
      growth: 1.4,
      opacity: 0.75,
    });
  }

  /** Continuous smoke from a damaged engine. */
  damageSmoke(position: THREE.Vector3, severity: number) {
    this.spawn({
      position: position.clone(),
      kind: 'smoke',
      colorFrom: severity > 0.6 ? 0x1d1a18 : 0x544d48,
      colorTo: 0x8e8884,
      size: 1.3 + severity * 1.6,
      life: 1.6 + severity * 0.9,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2),
      growth: 4.5 + severity * 3,
      opacity: 0.4 + severity * 0.35,
      buoyancy: 1.6,
      drag: 1.0,
      spin: (Math.random() - 0.5) * 0.8,
    });
    // Intermittent sparks when badly hurt.
    if (severity > 0.55 && Math.random() < 0.25) {
      this.spawn({
        position: position.clone(),
        kind: 'additive',
        colorFrom: 0xffd9a0,
        colorTo: 0xff5a1e,
        size: 0.4,
        life: 0.3,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 4,
          Math.random() * 6,
        ),
        growth: -0.5,
        opacity: 0.9,
        drag: 1.5,
      });
    }
  }

  /** Generic smoke puff (also used for cannon-hit marks). */
  smokePuff(position: THREE.Vector3, size = 2.4) {
    this.spawn({
      position: position.clone(),
      kind: 'smoke',
      colorFrom: 0x6b6663,
      colorTo: 0xa8a29d,
      size,
      life: 1.9,
      velocity: new THREE.Vector3(0, 1.1, 0),
      growth: size * 1.8,
      opacity: 0.55,
      buoyancy: 1.2,
    });
  }

  /** Muzzle flash at the gun port. */
  muzzleFlash(position: THREE.Vector3) {
    this.spawn({
      position: position.clone(),
      kind: 'additive',
      colorFrom: 0xfff4c4,
      colorTo: 0xffa02e,
      size: 1.5,
      life: 0.055,
      velocity: new THREE.Vector3(),
      growth: 4,
      opacity: 0.9,
    });
  }

  /** Sparks where a round strikes an aircraft. */
  impactSparks(position: THREE.Vector3, normal?: THREE.Vector3) {
    const count = this.scaled(3);
    for (let i = 0; i < count; i++) {
      const dir = normal
        ? normal.clone().multiplyScalar(4).add(
            new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7),
          )
        : new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      this.spawn({
        position: position.clone(),
        kind: 'additive',
        colorFrom: 0xfff0c0,
        colorTo: 0xff6a20,
        size: 0.34,
        life: 0.22 + Math.random() * 0.18,
        velocity: dir,
        growth: -0.4,
        opacity: 0.95,
        drag: 2.2,
      });
    }
    this.spawn({
      position: position.clone(),
      kind: 'additive',
      colorFrom: 0xffffff,
      colorTo: 0xffc27a,
      size: 1.0,
      life: 0.07,
      velocity: new THREE.Vector3(),
      growth: 2.6,
      opacity: 0.85,
    });
  }

  /** Dust kicked up where a round hits the ground. */
  groundImpact(position: THREE.Vector3) {
    const count = this.scaled(3);
    for (let i = 0; i < count; i++) {
      this.spawn({
        position: position.clone(),
        kind: 'smoke',
        colorFrom: 0xa8996f,
        colorTo: 0xd6cbb0,
        size: 1.2,
        life: 1.1 + Math.random() * 0.6,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          2 + Math.random() * 4,
          (Math.random() - 0.5) * 5,
        ),
        growth: 4.2,
        opacity: 0.6,
        buoyancy: 0.8,
        drag: 1.4,
      });
    }
  }

  /** Splash where an object or round strikes the sea. */
  waterSplash(position: THREE.Vector3, scale = 1) {
    const splashPos = position.clone();
    splashPos.y = 0.4;

    // Central column
    this.spawn({
      position: splashPos.clone(),
      kind: 'smoke',
      colorFrom: 0xffffff,
      colorTo: 0xcfe6ee,
      size: 2.6 * scale,
      life: 0.75,
      velocity: new THREE.Vector3(0, 11 * scale, 0),
      growth: 5 * scale,
      opacity: 0.85,
      drag: 1.8,
    });

    // Radial spray
    const count = this.scaled(4);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this.spawn({
        position: splashPos.clone(),
        kind: 'smoke',
        colorFrom: 0xf2fbff,
        colorTo: 0xbcd8e2,
        size: 1.5 * scale,
        life: 0.6 + Math.random() * 0.3,
        velocity: new THREE.Vector3(Math.cos(angle) * 7 * scale, 5 * scale, Math.sin(angle) * 7 * scale),
        growth: 4 * scale,
        opacity: 0.7,
        drag: 2.2,
      });
    }
  }

  addShake(amount: number) {
    this.shakeAmount = Math.min(2.2, this.shakeAmount + amount);
  }

  notifyDamage(fromDirection: THREE.Vector3) {
    this.lastDamageDirection = fromDirection.clone();
    this.damageFlashTimer = 1.1;
  }

  update(dt: number) {
    let active = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      active += 1;

      // Integrate with drag and buoyancy.
      if (p.drag > 0) p.velocity.multiplyScalar(Math.exp(-p.drag * dt));
      if (p.buoyancy !== 0) p.velocity.y += p.buoyancy * dt;
      p.sprite.position.addScaledVector(p.velocity, dt);

      const t = 1 - p.life / p.maxLife;
      const size = p.startSize + p.growth * t;
      p.sprite.scale.set(Math.max(0.01, size), Math.max(0.01, size), 1);
      if (p.spin !== 0) p.sprite.material.rotation += p.spin * dt;

      const mat = p.sprite.material as THREE.SpriteMaterial;
      // Fade out on an ease-in curve so particles vanish smoothly rather than popping.
      mat.opacity = p.startOpacity * (1 - t) * (1 - t * 0.35);
      mat.color.copy(this.tmpColor.copy(p.colorFrom).lerp(p.colorTo, t));
    }
    this.activeCount = active;

    for (const d of this.debrisPool) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.velocity.y -= GRAVITY * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.angular.x * dt;
      d.mesh.rotation.y += d.angular.y * dt;
      d.mesh.rotation.z += d.angular.z * dt;

      // Splash and retire when debris reaches the sea.
      if (d.mesh.position.y <= 0.2) {
        this.waterSplash(d.mesh.position, 0.5);
        d.active = false;
        d.mesh.visible = false;
      }
    }

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;
  }

  getShakeOffset(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.shakeAmount <= 0) return out.set(0, 0, 0);
    const s = this.shakeAmount;
    return out.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  /** Clears all live effects (used on mission restart). */
  reset() {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.visible = false;
    }
    for (const d of this.debrisPool) {
      d.active = false;
      d.mesh.visible = false;
    }
    this.shakeAmount = 0;
    this.damageFlashTimer = 0;
    this.lastDamageDirection = null;
    this.activeCount = 0;
  }

  dispose() {
    for (const p of this.pool) {
      this.scene.remove(p.sprite);
      (p.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const d of this.debrisPool) {
      this.scene.remove(d.mesh);
    }
    this.debrisPool[0]?.mesh.geometry.dispose();
    this.additiveMaterial.dispose();
    this.smokeMaterial.dispose();
    this.debrisMaterial.dispose();
    this.pool = [];
    this.debrisPool = [];
  }
}
