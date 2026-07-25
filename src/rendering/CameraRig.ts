import * as THREE from 'three';
import { SpringScalar, SpringVector3 } from './Spring';
import {
  CAMERA_AFTERBURNER_FOV_GAIN,
  CAMERA_BASE_FOV,
  CAMERA_FOV_REFERENCE_SPEED,
  CAMERA_FOV_SMOOTHING,
  CAMERA_GROUND_CLEARANCE,
  CAMERA_SPEED_FOV_GAIN,
  CHASE_BOOM_DISTANCE,
  CHASE_BOOM_HEIGHT,
  CHASE_FOLLOW_ROLL,
  CHASE_LOOK_AHEAD,
  CHASE_STIFFNESS_POSITION,
  CINEMATIC_BOOM_DISTANCE,
  CINEMATIC_BOOM_HEIGHT,
  CINEMATIC_STIFFNESS_POSITION,
  COCKPIT_EYE_OFFSET,
} from './RenderConstants';

export type CameraMode = 'cockpit' | 'chase' | 'cinematic';

export interface CameraRigInput {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
  speed: number;
  afterburner: boolean;
  rollDeg: number;
  /** Terrain/sea height under the camera, used for clearance clamping. */
  groundHeight: number;
  shake: THREE.Vector3;
  /** Free-look offsets in degrees, from the mouse. */
  lookYawDeg: number;
  lookPitchDeg: number;
}

/**
 * Camera placement for all three view modes.
 *
 * Pattern reference: OpenSkyFlight `js/camera/ChaseCameraController.js` (MIT) — the boom is
 * placed by rotating a fixed offset with a quaternion built from sprung angles, which avoids the
 * gimbal-lock and snap artefacts of lerping look-at targets directly. Adapted here to run off the
 * aircraft's own quaternion (so it works inverted), with a position spring, speed-driven FOV, and
 * a terrain-clearance clamp.
 */
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class CameraRig {
  /** Springs the aircraft-relative boom offset, so forward speed introduces no camera lag. */
  private offsetSpring = new SpringVector3();
  private fovSpring = new SpringScalar(CAMERA_BASE_FOV);
  private rollFollow = new SpringScalar(0);
  private needsSnap = true;

  private tmpOffset = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lookQuat = new THREE.Quaternion();
  private levelQuat = new THREE.Quaternion();

  /**
   * Scales the boom spring stiffness. >1 is tighter/snappier, <1 is looser/more cinematic.
   * Exposed as a setting because "how much the camera lags" is a strong personal preference.
   */
  dampingScale = 1;

  /** Forces the next update to place the camera instantly (mode change, mission restart). */
  snap() {
    this.needsSnap = true;
  }

  reset() {
    this.needsSnap = true;
    this.fovSpring.reset(CAMERA_BASE_FOV);
    this.rollFollow.reset(0);
  }

  update(camera: THREE.PerspectiveCamera, mode: CameraMode, input: CameraRigInput, dt: number) {
    // Free-look offset applied on top of the aircraft frame.
    this.tmpEuler.set(
      THREE.MathUtils.degToRad(input.lookPitchDeg),
      THREE.MathUtils.degToRad(input.lookYawDeg),
      0,
      'YXZ',
    );
    this.lookQuat.setFromEuler(this.tmpEuler);

    if (mode === 'cockpit') {
      this.updateCockpit(camera, input, dt);
    } else {
      this.updateExternal(camera, mode, input, dt);
    }

    this.updateFov(camera, input, dt);
    this.needsSnap = false;
  }

  private updateCockpit(camera: THREE.PerspectiveCamera, input: CameraRigInput, dt: number) {
    void dt;
    this.tmpOffset
      .set(COCKPIT_EYE_OFFSET.x, COCKPIT_EYE_OFFSET.y, COCKPIT_EYE_OFFSET.z)
      .applyQuaternion(input.quaternion);
    camera.position.copy(input.position).add(this.tmpOffset).add(input.shake);
    camera.quaternion.copy(input.quaternion).multiply(this.lookQuat);
  }

  private updateExternal(
    camera: THREE.PerspectiveCamera,
    mode: CameraMode,
    input: CameraRigInput,
    dt: number,
  ) {
    const isChase = mode === 'chase';
    const boomDistance = isChase ? CHASE_BOOM_DISTANCE : CINEMATIC_BOOM_DISTANCE;
    const boomHeight = isChase ? CHASE_BOOM_HEIGHT : CINEMATIC_BOOM_HEIGHT;
    const baseStiffness = isChase ? CHASE_STIFFNESS_POSITION : CINEMATIC_STIFFNESS_POSITION;
    // Squared so the slider maps to a perceptually even range (stiffness scales with damping^2).
    const stiffness = baseStiffness * this.dampingScale * this.dampingScale;

    // Partially follow roll: keeps the horizon readable while still conveying the bank.
    this.rollFollow.update(input.rollDeg * CHASE_FOLLOW_ROLL, 26, 0, dt);

    // Build the boom orientation from the aircraft heading/pitch but with damped roll, so the
    // camera does not barrel-roll with the aircraft.
    this.levelQuat.copy(input.quaternion);
    const rollCorrection = THREE.MathUtils.degToRad(this.rollFollow.value - input.rollDeg);
    this.tmpQuat.setFromAxisAngle(AXIS_Z, -rollCorrection);
    this.levelQuat.multiply(this.tmpQuat).multiply(this.lookQuat);

    // Spring the boom OFFSET (aircraft-relative), not the world position.
    //
    // This matters: a world-space position spring develops a steady-state lag proportional to
    // airspeed (2v/sqrt(k)), which at 300+ kts leaves the aircraft far ahead of frame. The offset
    // only changes when the aircraft *rotates*, so springing it gives smooth rotational damping
    // with zero translational lag — the aircraft stays put in frame at any speed. This is the same
    // reasoning behind OpenSkyFlight springing the boom's yaw/pitch angles rather than its position.
    this.tmpOffset.set(0, boomHeight, boomDistance).applyQuaternion(this.levelQuat);

    if (this.needsSnap) {
      this.offsetSpring.reset(this.tmpOffset);
    } else {
      this.offsetSpring.update(this.tmpOffset, stiffness, 0, dt);
    }

    this.tmpDesired.copy(input.position).add(this.offsetSpring.value);

    // Keep the camera above terrain/sea so it never dips underwater on low passes.
    const minY = input.groundHeight + CAMERA_GROUND_CLEARANCE;
    if (this.tmpDesired.y < minY) this.tmpDesired.y = minY;

    camera.position.copy(this.tmpDesired).add(input.shake);

    // Look slightly ahead of the aircraft, which steadies the aim point without pushing the
    // airframe out of frame.
    this.tmpLook.copy(input.position).addScaledVector(input.forward, CHASE_LOOK_AHEAD);
    camera.up.set(0, 1, 0).applyQuaternion(this.levelQuat);
    camera.lookAt(this.tmpLook);
  }

  private updateFov(camera: THREE.PerspectiveCamera, input: CameraRigInput, dt: number) {
    const speedNorm = THREE.MathUtils.clamp(input.speed / CAMERA_FOV_REFERENCE_SPEED, 0, 1);
    const targetFov =
      CAMERA_BASE_FOV +
      speedNorm * CAMERA_SPEED_FOV_GAIN +
      (input.afterburner ? CAMERA_AFTERBURNER_FOV_GAIN : 0);

    if (this.needsSnap) {
      this.fovSpring.reset(targetFov);
    } else {
      this.fovSpring.update(targetFov, CAMERA_FOV_SMOOTHING * CAMERA_FOV_SMOOTHING, 0, dt);
    }
    if (Math.abs(camera.fov - this.fovSpring.value) > 0.01) {
      camera.fov = this.fovSpring.value;
      camera.updateProjectionMatrix();
    }
  }
}
