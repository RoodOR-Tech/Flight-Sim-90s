import * as THREE from 'three';

const SIZE = 24000;
const SEGMENTS = 90;

/** A large, gently animated ocean plane. Wave motion is a cheap CPU sine displacement so it
 * stays compatible with scene fog and flat-shaded materials without a custom shader. */
export class Ocean {
  mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private basePositions: Float32Array;
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    this.geometry.rotateX(-Math.PI / 2);
    this.basePositions = Float32Array.from(this.geometry.attributes.position.array);

    const material = new THREE.MeshStandardMaterial({
      color: 0x0f4c74,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(dt: number) {
    this.elapsed += dt;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = this.elapsed;
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.basePositions[i];
      const z = this.basePositions[i + 2];
      const wave =
        Math.sin(x * 0.006 + t * 0.7) * 3.2 +
        Math.sin(z * 0.009 - t * 0.5) * 2.4 +
        Math.sin((x + z) * 0.015 + t * 1.1) * 1.1;
      arr[i + 1] = wave;
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  getHeightAt(_x: number, _z: number): number {
    // Sea level is treated as a flat plane at y=0 for gameplay/collision purposes;
    // the visual wave displacement is small and purely cosmetic.
    return 0;
  }
}
