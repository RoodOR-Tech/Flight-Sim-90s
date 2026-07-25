import * as THREE from 'three';
import { getSoftDotTexture } from '../game/AssetFactory';

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
  fadeColor: THREE.Color;
  growth: number;
}

const POOL_SIZE = 140;

/** Object-pooled particle effects: explosions, smoke, muzzle flashes and water splashes. Also
 * accumulates a decaying screen-shake magnitude the camera can sample each frame. */
export class EffectsSystem {
  private pool: Particle[] = [];
  private scene: THREE.Scene;
  shakeAmount = 0;
  lastDamageDirection: THREE.Vector3 | null = null;
  damageFlashTimer = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const tex = getSoftDotTexture();
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.set(1, 1, 1);
      scene.add(sprite);
      this.pool.push({ sprite, velocity: new THREE.Vector3(), life: 0, maxLife: 1, active: false, fadeColor: new THREE.Color(0xffffff), growth: 0 });
    }
  }

  private spawn(pos: THREE.Vector3, color: number, size: number, life: number, velocity: THREE.Vector3, growth: number) {
    const p = this.pool.find((x) => !x.active) ?? this.pool[0];
    p.active = true;
    p.life = life;
    p.maxLife = life;
    p.velocity.copy(velocity);
    p.growth = growth;
    p.fadeColor.set(color);
    p.sprite.visible = true;
    p.sprite.position.copy(pos);
    p.sprite.scale.set(size, size, size);
    const mat = p.sprite.material as THREE.SpriteMaterial;
    mat.color.set(color);
    mat.opacity = 1;
  }

  explosion(pos: THREE.Vector3, scale = 1) {
    this.spawn(pos, 0xffcc55, 6 * scale, 0.45, new THREE.Vector3(0, 1.5, 0), 10 * scale);
    this.spawn(pos, 0xff5522, 4 * scale, 0.65, new THREE.Vector3(0, 0.6, 0), 7 * scale);
    for (let i = 0; i < 5; i++) {
      const dir = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6);
      this.spawn(pos.clone(), 0x777777, 1.6, 1.6 + Math.random() * 0.6, dir, 4);
    }
    this.addShake(0.9 * scale);
  }

  smokePuff(pos: THREE.Vector3, size = 2.4) {
    this.spawn(pos, 0xaaaaaa, size, 2.4, new THREE.Vector3(0, 1.1, 0), size * 1.6);
  }

  muzzleFlash(pos: THREE.Vector3) {
    this.spawn(pos, 0xfff2aa, 1.4, 0.08, new THREE.Vector3(0, 0, 0), 1);
  }

  waterSplash(pos: THREE.Vector3) {
    const splashPos = pos.clone();
    splashPos.y = 0.4;
    this.spawn(splashPos, 0xdff2f5, 5, 0.7, new THREE.Vector3(0, 3, 0), 8);
  }

  addShake(amount: number) {
    this.shakeAmount = Math.min(2.2, this.shakeAmount + amount);
  }

  notifyDamage(fromDirection: THREE.Vector3) {
    this.lastDamageDirection = fromDirection.clone();
    this.damageFlashTimer = 1.1;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.velocity, dt);
      const t = 1 - p.life / p.maxLife;
      p.sprite.scale.addScalar(p.growth * dt);
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 1 - t;
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;
  }

  getShakeOffset(): THREE.Vector3 {
    if (this.shakeAmount <= 0) return new THREE.Vector3();
    const s = this.shakeAmount;
    return new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
}
