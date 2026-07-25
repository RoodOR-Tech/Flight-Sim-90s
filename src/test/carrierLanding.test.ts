import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Carrier, CARRIER_LOCAL } from '../entities/Carrier';
import { CollisionSystem, DECK_Y_MAX, DECK_Y_MIN } from '../systems/CollisionSystem';
import { evaluateLanding } from '../flight/LandingEvaluator';
import { PRESETS } from '../rendering/GraphicsPresets';

/**
 * End-to-end verification of the carrier-landing decision, exercising the same three pieces the
 * game wires together: deck-contact classification, arresting-zone bounds, and landing evaluation.
 *
 * This closes the loop that an automated flying bot cannot reliably reach: it places the aircraft at
 * exact world positions on the deck and asserts the trap triggers (or is correctly refused).
 */
function makeCarrier(headingDeg = 90, position = new THREE.Vector3(0, 0, 0)): Carrier {
  const scene = new THREE.Scene();
  return new Carrier(scene, position, headingDeg, PRESETS.low);
}

/** Converts a carrier-local point to world space. */
function local(carrier: Carrier, x: number, y: number, z: number): THREE.Vector3 {
  return carrier.localToWorld(new THREE.Vector3(x, y, z));
}

function angleDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

describe('carrier deck contact classification', () => {
  it('classifies a point just above the arresting zone as deck contact', () => {
    const carrier = makeCarrier();
    const pos = local(carrier, CARRIER_LOCAL.deckCenterline, CARRIER_LOCAL.deckY, CARRIER_LOCAL.arrestingZoneStart.z + 20);
    expect(CollisionSystem.carrierContact(pos, carrier)).toBe('deck');
  });

  it('classifies a point below the deck surface as a hull strike', () => {
    const carrier = makeCarrier();
    const pos = local(carrier, CARRIER_LOCAL.deckCenterline, DECK_Y_MIN - 0.5, 70);
    expect(CollisionSystem.carrierContact(pos, carrier)).toBe('hull');
  });

  it('classifies a high overflight as no contact, allowing a wave-off', () => {
    const carrier = makeCarrier();
    const pos = local(carrier, CARRIER_LOCAL.deckCenterline, DECK_Y_MAX + 5, 70);
    expect(CollisionSystem.carrierContact(pos, carrier)).toBe('none');
  });

  it('classifies a point well off to the side as no contact', () => {
    const carrier = makeCarrier();
    const pos = local(carrier, 60, CARRIER_LOCAL.deckY, 70);
    expect(CollisionSystem.carrierContact(pos, carrier)).toBe('none');
  });

  it('detects deck contact regardless of the carrier heading', () => {
    for (const heading of [0, 45, 90, 180, 270]) {
      const carrier = makeCarrier(heading, new THREE.Vector3(1200, 0, -800));
      const pos = local(carrier, CARRIER_LOCAL.deckCenterline, CARRIER_LOCAL.deckY, 70);
      expect(CollisionSystem.carrierContact(pos, carrier), `heading ${heading}`).toBe('deck');
    }
  });

  it('reports a local deck position consistent with the world round-trip', () => {
    const carrier = makeCarrier(137, new THREE.Vector3(-450, 0, 900));
    const localIn = new THREE.Vector3(CARRIER_LOCAL.deckCenterline, CARRIER_LOCAL.deckY, 74);
    const world = carrier.localToWorld(localIn);
    const back = CollisionSystem.localDeckPosition(world, carrier);
    expect(back.x).toBeCloseTo(localIn.x, 3);
    expect(back.y).toBeCloseTo(localIn.y, 3);
    expect(back.z).toBeCloseTo(localIn.z, 3);
  });
});

describe('arrested landing decision', () => {
  /** Mirrors the sequence Game.updateLandingLogic performs. */
  function attemptLanding(opts: {
    carrierHeading?: number;
    localX?: number;
    localY?: number;
    localZ?: number;
    aircraftHeading?: number;
    speed?: number;
    descentRate?: number;
    gearDown?: boolean;
  }) {
    const heading = opts.carrierHeading ?? 90;
    const carrier = makeCarrier(heading);
    const pos = local(
      carrier,
      opts.localX ?? CARRIER_LOCAL.deckCenterline,
      opts.localY ?? CARRIER_LOCAL.deckY,
      opts.localZ ?? 74,
    );

    const contact = CollisionSystem.carrierContact(pos, carrier);
    if (contact !== 'deck') return { contact, evaluation: null };

    const localPos = CollisionSystem.localDeckPosition(pos, carrier);
    const inArrestingZone =
      localPos.z > CARRIER_LOCAL.arrestingZoneStart.z && localPos.z < CARRIER_LOCAL.arrestingZoneEnd.z;

    const evaluation = evaluateLanding({
      gearDown: opts.gearDown ?? true,
      speed: opts.speed ?? 65,
      descentRate: opts.descentRate ?? 4,
      lateralOffset: localPos.x - CARRIER_LOCAL.deckCenterline,
      headingDiffDeg: angleDiffDeg(opts.aircraftHeading ?? heading, heading),
      inArrestingZone,
    });
    return { contact, evaluation };
  }

  it('traps a well-flown approach', () => {
    const { contact, evaluation } = attemptLanding({});
    expect(contact).toBe('deck');
    expect(evaluation?.success, evaluation?.reasons.join(', ')).toBe(true);
  });

  it('traps a slightly high, slightly fast, slightly crooked approach (forgiving)', () => {
    const { evaluation } = attemptLanding({
      localY: CARRIER_LOCAL.deckY + 3,
      speed: 92,
      descentRate: 11,
      localX: CARRIER_LOCAL.deckCenterline + 8,
      aircraftHeading: 90 + 25,
    });
    expect(evaluation?.success, evaluation?.reasons.join(', ')).toBe(true);
  });

  it('refuses a gear-up touchdown', () => {
    const { evaluation } = attemptLanding({ gearDown: false });
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('gear up');
  });

  it('refuses a touchdown short of the arresting zone', () => {
    const { evaluation } = attemptLanding({ localZ: CARRIER_LOCAL.arrestingZoneStart.z - 20 });
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('not in arresting zone');
  });

  it('refuses a touchdown beyond the arresting zone', () => {
    const { evaluation } = attemptLanding({ localZ: CARRIER_LOCAL.arrestingZoneEnd.z + 5 });
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('not in arresting zone');
  });

  it('refuses an approach off the centreline but still over the deck', () => {
    // 13 m off centreline is still within the deck footprint, so contact registers and the
    // lateral tolerance is what rejects it.
    const { contact, evaluation } = attemptLanding({ localX: CARRIER_LOCAL.deckCenterline + 13 });
    expect(contact).toBe('deck');
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('off centerline');
  });

  it('registers no contact at all when the aircraft passes beyond the deck edge', () => {
    // Past the deck edge there is nothing to land on — this is a flyby, not a crash.
    const { contact, evaluation } = attemptLanding({ localX: CARRIER_LOCAL.deckCenterline + 20 });
    expect(contact).toBe('none');
    expect(evaluation).toBeNull();
  });

  it('refuses a badly misaligned approach', () => {
    const { evaluation } = attemptLanding({ aircraftHeading: 90 + 70 });
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('misaligned with deck');
  });

  it('refuses an excessive sink rate', () => {
    const { evaluation } = attemptLanding({ descentRate: 22 });
    expect(evaluation?.success).toBe(false);
    expect(evaluation?.reasons).toContain('descent rate too high');
  });

  it('traps successfully on any carrier heading', () => {
    for (const heading of [0, 90, 180, 270, 137]) {
      const { evaluation } = attemptLanding({ carrierHeading: heading, aircraftHeading: heading });
      expect(evaluation?.success, `heading ${heading}: ${evaluation?.reasons.join(', ')}`).toBe(true);
    }
  });
});
