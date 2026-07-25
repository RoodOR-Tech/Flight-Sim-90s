import * as THREE from 'three';

export type TeamId = 'player' | 'enemy' | 'neutral';
export type TargetKind = 'aircraft' | 'ground';

/** Minimal shape any radar-trackable / lockable / damageable object exposes to the combat & radar systems. */
export interface Targetable {
  id: string;
  team: TeamId;
  kind: TargetKind;
  label: string;
  getPosition(): THREE.Vector3;
  getVelocity(): THREE.Vector3;
  isAlive(): boolean;
  applyDamage(amount: number, fromDirection: THREE.Vector3): void;
  getCollisionRadius(): number;
}
