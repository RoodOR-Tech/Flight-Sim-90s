import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AircraftController } from '../flight/AircraftController';
import { DEFAULT_FLIGHT_CONFIG, FlightControls, FlightModel } from '../flight/FlightModel';

const NEUTRAL: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttleInput: 0, afterburner: false };

function makeController() {
  const fm = new FlightModel({ ...DEFAULT_FLIGHT_CONFIG });
  fm.turbulence = false;
  return new AircraftController(new THREE.Group(), fm);
}

/**
 * Gear and flap toggling is a gameplay contract, not a cosmetic detail: a successful carrier
 * landing requires gear down, so if these toggles do not work the mission cannot be completed.
 */
describe('AircraftController gear and flaps', () => {
  it('starts with gear down and flaps up', () => {
    const c = makeController();
    expect(c.flightModel.gearDown).toBe(true);
    expect(c.flightModel.flapsDown).toBe(false);
  });

  it('toggles the gear and reports the new state', () => {
    const c = makeController();
    expect(c.toggleGear()).toBe(false);
    expect(c.flightModel.gearDown).toBe(false);
  });

  it('toggles the flaps and reports the new state', () => {
    const c = makeController();
    expect(c.toggleFlaps()).toBe(true);
    expect(c.flightModel.flapsDown).toBe(true);
  });

  it('ignores a second gear toggle inside the cooldown window', () => {
    const c = makeController();
    c.toggleGear(); // now up
    expect(c.flightModel.gearDown).toBe(false);
    c.toggleGear(); // suppressed by the cooldown
    expect(c.flightModel.gearDown).toBe(false);
  });

  it('allows the gear to be toggled again once the cooldown elapses', () => {
    const c = makeController();
    c.toggleGear();
    expect(c.flightModel.gearDown).toBe(false);
    // Advance past the cooldown by stepping the controller.
    for (let i = 0; i < 100; i++) c.step(1 / 60, NEUTRAL);
    c.toggleGear();
    expect(c.flightModel.gearDown).toBe(true);
  });

  it('can be cycled up and down repeatedly, which a landing requires', () => {
    const c = makeController();
    const advance = () => {
      for (let i = 0; i < 100; i++) c.step(1 / 60, NEUTRAL);
    };
    // Retract after launch...
    c.toggleGear();
    expect(c.flightModel.gearDown).toBe(false);
    advance();
    // ...then extend again for recovery.
    c.toggleGear();
    expect(c.flightModel.gearDown).toBe(true);
    advance();
    c.toggleFlaps();
    expect(c.flightModel.flapsDown).toBe(true);
  });

  it('lowers the effective stall speed when flaps are extended', () => {
    const withoutFlaps = makeController();
    const withFlaps = makeController();
    withFlaps.toggleFlaps();

    // Fly both at a speed between the flapped and clean stall speeds.
    const speed = DEFAULT_FLIGHT_CONFIG.stallSpeed * 0.85;
    for (const c of [withoutFlaps, withFlaps]) {
      c.flightModel.position.set(0, 500, 0);
      c.flightModel.velocity.set(0, 0, -speed);
      c.step(1 / 60, NEUTRAL);
    }

    expect(withoutFlaps.flightModel.stalling, 'clean wing should stall').toBe(true);
    expect(withFlaps.flightModel.stalling, 'flaps should prevent the stall').toBe(false);
  });

  it('adds drag when gear and flaps are extended', () => {
    const clean = makeController();
    const dirty = makeController();
    dirty.toggleGear(); // gear up on the clean one instead
    clean.toggleGear();

    // clean now has gear UP, dirty has gear DOWN; give dirty flaps too.
    for (let i = 0; i < 100; i++) dirty.step(1 / 60, NEUTRAL);
    dirty.toggleFlaps();

    for (const c of [clean, dirty]) {
      c.flightModel.position.set(0, 800, 0);
      c.flightModel.velocity.set(0, 0, -200);
      c.flightModel.throttle = 0;
    }
    for (let i = 0; i < 120; i++) {
      clean.step(1 / 60, NEUTRAL);
      dirty.step(1 / 60, NEUTRAL);
    }

    expect(dirty.flightModel.getSpeed(), 'dirty configuration should decelerate faster')
      .toBeLessThan(clean.flightModel.getSpeed());
  });
});
