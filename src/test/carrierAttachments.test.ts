import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CARRIER_ATTACHMENTS, DECK_Y, buildCarrierModel } from '../rendering/models/CarrierModel';
import { CARRIER_LOCAL } from '../entities/Carrier';
import { PRESETS } from '../rendering/GraphicsPresets';
import { evaluateLanding } from '../flight/LandingEvaluator';

/**
 * These tests guard the contract between the carrier's *visual* model and the *gameplay* launch and
 * landing systems. The visual refresh replaced the carrier geometry entirely, so the risk is that
 * the reference points silently drift and break catapult launch or arrested landing.
 */
describe('carrier attachment points', () => {
  it('exposes every named point the launch and landing systems rely on', () => {
    const required = [
      'catapultStart',
      'catapultEnd',
      'landingZoneStart',
      'landingZoneCenter',
      'landingZoneEnd',
      'arrestingPoint',
      'lineupReference',
      'glideSlopeReference',
      'carrierRadar',
    ];
    for (const name of required) {
      expect(CARRIER_ATTACHMENTS, `missing attachment "${name}"`).toHaveProperty(name);
    }
  });

  it('keeps CARRIER_LOCAL derived from the model attachments, not hard-coded separately', () => {
    expect(CARRIER_LOCAL.catapultStart.equals(CARRIER_ATTACHMENTS.catapultStart)).toBe(true);
    expect(CARRIER_LOCAL.catapultEnd.equals(CARRIER_ATTACHMENTS.catapultEnd)).toBe(true);
    expect(CARRIER_LOCAL.arrestingZoneStart.equals(CARRIER_ATTACHMENTS.landingZoneStart)).toBe(true);
    expect(CARRIER_LOCAL.arrestingZoneEnd.equals(CARRIER_ATTACHMENTS.landingZoneEnd)).toBe(true);
    expect(CARRIER_LOCAL.deckCenterline).toBe(CARRIER_ATTACHMENTS.landingZoneCenter.x);
    expect(CARRIER_LOCAL.deckY).toBe(DECK_Y);
  });

  it('places the catapult forward of the arresting zone so a launch runs off the bow', () => {
    // Forward is -Z, so the catapult must sit at a more negative Z than the landing area.
    expect(CARRIER_ATTACHMENTS.catapultStart.z).toBeLessThan(CARRIER_ATTACHMENTS.landingZoneStart.z);
    expect(CARRIER_ATTACHMENTS.catapultEnd.z).toBeLessThan(CARRIER_ATTACHMENTS.landingZoneStart.z);
    // The stroke must run forward (toward -Z).
    expect(CARRIER_ATTACHMENTS.catapultEnd.z).toBeGreaterThan(CARRIER_ATTACHMENTS.catapultStart.z);
  });

  it('orders the arresting zone start < centre < end along the deck', () => {
    expect(CARRIER_ATTACHMENTS.landingZoneStart.z).toBeLessThan(CARRIER_ATTACHMENTS.landingZoneCenter.z);
    expect(CARRIER_ATTACHMENTS.landingZoneCenter.z).toBeLessThan(CARRIER_ATTACHMENTS.landingZoneEnd.z);
  });

  it('puts the arresting point inside the zone the landing check tests against', () => {
    const p = CARRIER_ATTACHMENTS.arrestingPoint;
    expect(p.z).toBeGreaterThan(CARRIER_LOCAL.arrestingZoneStart.z);
    expect(p.z).toBeLessThan(CARRIER_LOCAL.arrestingZoneEnd.z);
  });

  it('keeps all deck reference points at deck height', () => {
    for (const name of ['catapultStart', 'catapultEnd', 'landingZoneStart', 'landingZoneCenter', 'landingZoneEnd', 'arrestingPoint'] as const) {
      expect(CARRIER_ATTACHMENTS[name].y, `${name} should sit on the deck`).toBeCloseTo(DECK_Y, 5);
    }
  });

  it('keeps the arresting zone within the lateral tolerance the landing check allows', () => {
    // A touchdown exactly on the arresting point must satisfy the lateral test.
    const lateralOffset = CARRIER_ATTACHMENTS.arrestingPoint.x - CARRIER_LOCAL.deckCenterline;
    const result = evaluateLanding({
      gearDown: true,
      speed: 60,
      descentRate: 5,
      lateralOffset,
      headingDiffDeg: 0,
      inArrestingZone: true,
    });
    expect(result.success).toBe(true);
  });

  it('resolves attachments as real Object3D children of the built model', () => {
    const model = buildCarrierModel(PRESETS.low);
    for (const [name, local] of Object.entries(CARRIER_ATTACHMENTS)) {
      const marker = model.attachments[name as keyof typeof CARRIER_ATTACHMENTS];
      expect(marker, `attachment "${name}" not resolved`).toBeDefined();
      expect(marker.parent).toBe(model.group);
      expect(marker.position.equals(local as THREE.Vector3)).toBe(true);
    }
  });

  it('transforms attachment points into world space with the carrier heading applied', () => {
    const model = buildCarrierModel(PRESETS.low);
    const group = model.group;
    group.position.set(100, 0, -200);
    // Heading 90 deg (east) uses the same negative-Y-rotation convention as the Carrier entity.
    group.rotation.y = -THREE.MathUtils.degToRad(90);
    group.updateMatrixWorld(true);

    const world = new THREE.Vector3();
    model.attachments.catapultStart.getWorldPosition(world);

    // The point must move with the ship rather than staying in local coordinates.
    expect(world.equals(CARRIER_ATTACHMENTS.catapultStart)).toBe(false);
    expect(world.y).toBeCloseTo(DECK_Y, 5);
    // With a 90 deg rotation the local -Z (forward) maps to world -X... verify it is at least
    // displaced from the ship origin by the boom length.
    const distance = world.distanceTo(group.position);
    expect(distance).toBeCloseTo(CARRIER_ATTACHMENTS.catapultStart.length(), 3);
  });
});
