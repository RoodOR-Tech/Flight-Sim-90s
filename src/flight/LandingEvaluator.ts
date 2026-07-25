export interface LandingConditions {
  gearDown: boolean;
  speed: number; // m/s
  descentRate: number; // m/s, positive = descending
  lateralOffset: number; // meters from deck centerline
  headingDiffDeg: number; // absolute-able difference from carrier heading
  inArrestingZone: boolean;
}

export interface LandingEvaluation {
  success: boolean;
  reasons: string[];
}

const MAX_LATERAL_OFFSET = 12;
const MAX_HEADING_DIFF = 40;
const MIN_SPEED = 28;
const MAX_SPEED = 100;
const MAX_DESCENT_RATE = 14;

/**
 * Pure evaluation of whether a touchdown in the carrier's arresting zone counts as a
 * successful trap. Kept standalone (no engine/scene dependencies) so it's cheaply unit-testable.
 */
export function evaluateLanding(c: LandingConditions): LandingEvaluation {
  const reasons: string[] = [];
  if (!c.inArrestingZone) reasons.push('not in arresting zone');
  if (!c.gearDown) reasons.push('gear up');
  if (Math.abs(c.lateralOffset) >= MAX_LATERAL_OFFSET) reasons.push('off centerline');
  if (Math.abs(c.headingDiffDeg) >= MAX_HEADING_DIFF) reasons.push('misaligned with deck');
  if (c.speed <= MIN_SPEED || c.speed >= MAX_SPEED) reasons.push('airspeed out of range');
  if (c.descentRate >= MAX_DESCENT_RATE) reasons.push('descent rate too high');

  return { success: reasons.length === 0, reasons };
}
