import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_FLIGHT_CONFIG, FlightControls, FlightModel } from '../flight/FlightModel';

const LEVEL: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttleInput: 0, afterburner: false };

function makeAirborne(speed = 150, heading = 90): FlightModel {
  const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG });
  fm.turbulence = false; // deterministic
  fm.position.set(0, 500, 0);
  fm.throttle = 0.7;
  const headingRad = THREE.MathUtils.degToRad(heading);
  // Heading convention: forward = -Z rotated about +Y by -heading.
  fm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -headingRad);
  fm.velocity.copy(fm.getForward().multiplyScalar(speed));
  return fm;
}

function run(fm: FlightModel, controls: Partial<FlightControls>, seconds: number, dt = 1 / 60) {
  const c = { ...LEVEL, ...controls };
  for (let t = 0; t < seconds; t += dt) fm.step(dt, c);
}

function headingDelta(from: number, to: number): number {
  let d = to - from;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

describe('FlightModel bank angle reporting', () => {
  it('reports zero bank when level', () => {
    const fm = makeAirborne();
    expect(fm.getRollDegrees()).toBeCloseTo(0, 4);
  });

  it('reports the true bank angle, not a compressed one', () => {
    // Roll 45 deg to the right about the forward axis (-Z).
    for (const bank of [15, 30, 45, 60]) {
      const fm = makeAirborne();
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(-bank), // negative Z rotation = right wing down
      );
      fm.quaternion.multiply(q);
      // Sign convention: a right bank reads negative.
      expect(Math.abs(fm.getRollDegrees())).toBeCloseTo(bank, 1);
    }
  });

  it('unwraps bank angles past vertical using the up vector', () => {
    const fm = makeAirborne();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    fm.quaternion.multiply(q);
    expect(Math.abs(fm.getRollDegrees())).toBeCloseTo(180, 1);
    expect(fm.getUp().y).toBeLessThan(0);
  });
});

describe('FlightModel banked turn', () => {
  it('changes heading while banked, with no pitch input', () => {
    const fm = makeAirborne(150, 90);
    // Establish a bank with roll input, then hold it.
    run(fm, { roll: 1 }, 0.35);
    const bank = Math.abs(fm.getRollDegrees());
    expect(bank, 'roll input should establish a bank').toBeGreaterThan(15);

    const before = fm.getHeadingDegrees();
    run(fm, {}, 3);
    const delta = headingDelta(before, fm.getHeadingDegrees());

    // A sustained bank must turn the aircraft — this is the behaviour the weathervane damping
    // would otherwise cancel entirely.
    expect(Math.abs(delta), 'a held bank must change heading').toBeGreaterThan(5);
  });

  it('turns right when banked right and left when banked left', () => {
    const right = makeAirborne(150, 90);
    run(right, { roll: 1 }, 0.4);
    const rBefore = right.getHeadingDegrees();
    run(right, {}, 2);
    const rDelta = headingDelta(rBefore, right.getHeadingDegrees());

    const left = makeAirborne(150, 90);
    run(left, { roll: -1 }, 0.4);
    const lBefore = left.getHeadingDegrees();
    run(left, {}, 2);
    const lDelta = headingDelta(lBefore, left.getHeadingDegrees());

    expect(rDelta).toBeGreaterThan(0);
    expect(lDelta).toBeLessThan(0);
  });

  it('turns faster at a steeper bank', () => {
    const shallow = makeAirborne(150, 90);
    run(shallow, { roll: 1 }, 0.2);
    const sBefore = shallow.getHeadingDegrees();
    run(shallow, {}, 2);
    const shallowDelta = Math.abs(headingDelta(sBefore, shallow.getHeadingDegrees()));

    const steep = makeAirborne(150, 90);
    run(steep, { roll: 1 }, 0.6);
    const stBefore = steep.getHeadingDegrees();
    run(steep, {}, 2);
    const steepDelta = Math.abs(headingDelta(stBefore, steep.getHeadingDegrees()));

    expect(Math.abs(steep.getRollDegrees())).toBeGreaterThan(Math.abs(shallow.getRollDegrees()));
    expect(steepDelta).toBeGreaterThan(shallowDelta);
  });

  it('does not change heading when the wings are level', () => {
    const fm = makeAirborne(150, 90);
    const before = fm.getHeadingDegrees();
    run(fm, {}, 3);
    expect(Math.abs(headingDelta(before, fm.getHeadingDegrees()))).toBeLessThan(1);
  });

  it('does not spin on the ground below flying speed', () => {
    const fm = makeAirborne(150, 90);
    fm.velocity.set(0, 0, 0); // stationary
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(-30),
    );
    fm.quaternion.multiply(q);
    const before = fm.getHeadingDegrees();
    // One step only, so gravity does not accelerate it back to flying speed.
    fm.step(1 / 60, LEVEL);
    expect(Math.abs(headingDelta(before, fm.getHeadingDegrees()))).toBeLessThan(0.01);
  });

  it('keeps the bank angle stable while turning (the turn must not roll the aircraft)', () => {
    const fm = makeAirborne(150, 90);
    run(fm, { roll: 1 }, 0.4);
    const bankBefore = fm.getRollDegrees();
    run(fm, {}, 2);
    // The heading rotation is applied about the world up axis, so it must not induce roll.
    expect(fm.getRollDegrees()).toBeCloseTo(bankBefore, 0);
  });
});

describe('FlightModel stability', () => {
  it('does not diverge meaningfully between 60 Hz and 120 Hz integration', () => {
    // The game always drives this model on a fixed 1/60 accumulator, so exact step-size invariance
    // is not required. What matters is that the integrator is stable enough that halving the step
    // does not change the trajectory materially.
    const a = makeAirborne(150, 90);
    const b = makeAirborne(150, 90);
    run(a, { roll: 1, pitch: 0.3 }, 2, 1 / 60);
    run(b, { roll: 1, pitch: 0.3 }, 2, 1 / 120);

    const headingDiff = Math.abs(headingDelta(a.getHeadingDegrees(), b.getHeadingDegrees()));
    expect(headingDiff, 'heading should agree within a couple of degrees').toBeLessThan(2);
    expect(Math.abs(a.position.y - b.position.y), 'altitude within a few metres').toBeLessThan(15);
    expect(Math.abs(a.getSpeed() - b.getSpeed()), 'speed within a few m/s').toBeLessThan(5);
  });

  it('produces finite state after aggressive sustained input', () => {
    const fm = makeAirborne(150, 90);
    run(fm, { roll: 1, pitch: 1, yaw: 1, throttleInput: 1, afterburner: true }, 12);
    expect(Number.isFinite(fm.position.x)).toBe(true);
    expect(Number.isFinite(fm.position.y)).toBe(true);
    expect(Number.isFinite(fm.getSpeed())).toBe(true);
    expect(Number.isFinite(fm.getHeadingDegrees())).toBe(true);
    expect(fm.quaternion.length()).toBeCloseTo(1, 3);
  });
});
