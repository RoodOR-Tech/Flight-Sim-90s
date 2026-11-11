// Mission catalogue: the data that differs between missions (briefing text, loadout, objectives).
// The stage machine itself lives in MissionManager; the entities are spawned by Game.

export type MissionId = 'broken_beacon' | 'iron_anvil';

export interface MissionLoadout {
  missiles: number;
  /** Shown on the HUD and briefing, e.g. "MISSILES" or "AT MISSILES". */
  missileLabel: string;
  bombs: number;
}

export interface MissionDefinition {
  id: MissionId;
  name: string;
  /** Short label for the mission-select buttons. */
  shortName: string;
  situation: string;
  objectives: string[];
  weather: string;
  loadoutLines: string[];
  threat: string;
  loadout: MissionLoadout;
}

export const MISSION_ORDER: MissionId[] = ['broken_beacon', 'iron_anvil'];

export const MISSIONS: Record<MissionId, MissionDefinition> = {
  broken_beacon: {
    id: 'broken_beacon',
    name: 'Operation Broken Beacon',
    shortName: '1: BROKEN BEACON',
    situation:
      'Hostile fighters designated Kestrel-9 are massing east of the task force. A coastal early-warning ' +
      'radar is vectoring them toward CVN Resolute. Fleet intelligence confirms the installation is ' +
      'purely military; nearby coastal structures are civilian and must not be engaged.',
    objectives: [
      'Launch and proceed to waypoint ALPHA',
      'Intercept and destroy two Kestrel-9 fighters',
      'Proceed to waypoint BRAVO and destroy the coastal radar site',
      'Return to CVN Resolute and land',
      'Do not engage civilian structures',
    ],
    weather: 'Scattered clouds, light haze, sea state 2. Estimated mission duration: 10-15 minutes.',
    loadoutLines: ['1x 20mm cannon, 240 rounds', '4x radar-guided air-to-air missiles'],
    threat: '2x Kestrel-9 fighters (cannon + missiles), 1x coastal early-warning radar.',
    loadout: { missiles: 4, missileLabel: 'MISSILES', bombs: 0 },
  },
  iron_anvil: {
    id: 'iron_anvil',
    name: 'Operation Iron Anvil',
    shortName: '2: IRON ANVIL',
    situation:
      'With the radar net down, an armoured column of Bulwark main battle tanks has been spotted moving ' +
      'across the western mainland plateau toward the coast. Two mobile flak vehicles are escorting it. ' +
      'Stop the column inland, before it reaches the landing beaches.',
    objectives: [
      'Launch and cross the coast at waypoint COAST',
      'Destroy all six Bulwark tanks of the armoured column',
      'Flak vehicles are optional targets, but they will shoot back',
      'Return to CVN Resolute and land',
    ],
    weather: 'Scattered clouds, light haze over land. Estimated mission duration: 10-15 minutes.',
    loadoutLines: [
      '1x 20mm cannon, 240 rounds',
      '4x guided anti-tank missiles (lock with T / L, fire with R)',
      '6x unguided 250 kg bombs (release with X, aim with the CCIP pipper)',
    ],
    threat: '6x Bulwark tanks (no anti-air), 2x flak vehicles (radar-laid cannon, effective below 900 m).',
    loadout: { missiles: 4, missileLabel: 'AT MISSILES', bombs: 6 },
  },
};
