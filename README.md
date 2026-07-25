# Operation Broken Beacon

A complete, playable single-player 3D naval combat flight-simulator mission for the browser,
built with TypeScript and Three.js. It recreates the broad gameplay feel of mid-1990s PC combat
sims — low-poly carrier aviation, radar interception, missile combat, and a retro green HUD —
as an entirely original game.

> **Originality statement:** This is an original game inspired only by the broad conventions of
> 1990s combat-flight simulators (arcade flight models, carrier launch/recovery, radar lock,
> retro monochrome HUDs). It contains **no code, artwork, text, audio, or design assets copied
> from U.S. Navy Fighters Gold** or any other commercial title. All aircraft, ships, terrain,
> effects, mission text, and radio dialogue are original and generated procedurally from
> Three.js primitives and hand-written copy.

## Screenshots

_Screenshots are not included in this repository. Run `npm run dev` and open the app locally to
see the title screen, briefing, HUD, tactical map, and mission-results screens in action._

- `docs/screenshot-title.png` — placeholder (not included)
- `docs/screenshot-hud.png` — placeholder (not included)
- `docs/screenshot-map.png` — placeholder (not included)
- `docs/screenshot-results.png` — placeholder (not included)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens a Vite dev server (default `http://localhost:5173`). No backend, API keys, or accounts
are required — everything runs client-side.

## Production build

```bash
npm run build
npm run preview   # serve the production build locally to try it
```

## Tests

```bash
npm test          # Vitest unit tests (scoring, radar lock, mission stages, landing, damage)
npm run test:e2e  # Playwright smoke test (title -> briefing -> mission start -> HUD, no errors)
```

## The mission

**Operation Broken Beacon** — hostile "Kestrel-9" fighters are massing near a coastal early-warning
radar station that is vectoring them toward the carrier group. You fly **Viper One**, launching
from the **CVN Resolute**, to:

1. Launch from the carrier catapult.
2. Navigate to waypoint **ALPHA**.
3. Intercept and destroy **two** Kestrel-9 fighters.
4. Navigate to waypoint **BRAVO** and destroy the coastal **radar site** (only active as a target
   once both fighters are down).
5. Return to CVN Resolute and land.
6. Review your mission score.

Civilian structures near the coast must not be engaged — one accidental hit is only a warning,
repeated hits will fail the mission.

## Controls

| Key | Action |
| --- | --- |
| W / S | Pitch down / pitch up |
| A / D | Roll left / right |
| Q / E | Yaw left / right |
| Arrow keys | Alternate flight controls (same as WASD) |
| Shift | Increase throttle |
| Ctrl | Decrease throttle |
| B | Afterburner |
| Space | Fire cannon |
| R | Fire selected/locked missile |
| T | Cycle radar target |
| L | Hold to attempt radar lock |
| G | Toggle landing gear |
| F | Toggle flaps |
| C | Cycle camera (chase / cockpit / cinematic) |
| M | Toggle tactical map (pauses flight) |
| P | Pause |
| Escape | Pause / menu |
| Enter | Advance briefing / confirm |

Mouse movement provides a small look-around offset in cockpit and chase view; its sensitivity is
adjustable in Settings. A **Skip Carrier Launch** checkbox on the briefing screen starts you
already airborne for faster testing/replays.

## Gameplay tips

- The flight model has momentum: the aircraft doesn't "fly like a camera." Bank into turns and
  ease the nose up to keep from bleeding altitude in a hard turn.
- Missiles need a completed radar lock (hold **L** on a cycled target, within cone and range) — a
  `SHOOT` cue and `RADAR LOCK` warning appear on the HUD when you're ready to fire.
- The cannon is unguided and has a short effective range — get inside ~400m and lead your target.
- Watch the radar scope (bottom-right of the HUD) and the tactical map (**M**) for bogeys, the
  carrier, the radar site, and your current waypoint.
- Landing is forgiving: gear down, flaps down, roughly aligned with the deck, moderate speed and
  descent rate, touching down in the arresting zone is enough to catch the wire. The landing
  guidance box (top of HUD near the carrier) shows lineup and glideslope.
- If you're destroyed, crash, or stray too far from the combat area for too long, the mission ends
  in failure — you can restart immediately from the results screen.

## Architecture

```text
src/
  main.ts                   Entry point
  game/
    Game.ts                 Main loop, screen state machine, camera, HUD/map data assembly
    GameState.ts             Cross-screen settings/session state
    MissionManager.ts        Mission stage progression, radio messages, failure conditions
    InputManager.ts          Keyboard/mouse input, edge-triggered actions
    AudioManager.ts          Web Audio-synthesized sound effects (no audio files)
    AssetFactory.ts          Procedural Three.js geometry for every visual in the game
    Constants.ts / Types.ts  Shared tunables and interfaces
  flight/
    FlightModel.ts           Arcade lift/thrust/drag physics, fixed-timestep integration
    AircraftController.ts    Wraps FlightModel with health/gear/flap state + mesh sync
    LandingEvaluator.ts       Pure, unit-tested carrier-landing success/failure evaluation
  entities/
    PlayerAircraft.ts, EnemyAircraft.ts, Missile.ts, Projectile.ts, Carrier.ts, GroundTarget.ts
  systems/
    CombatSystem.ts          Projectile/missile lifecycle, hit detection, damage application
    RadarSystem.ts           Target cycling and radar-lock acquisition/maintenance
    CollisionSystem.ts       Terrain/ocean/carrier/aircraft collision checks
    EffectsSystem.ts         Pooled particles (explosions, smoke, muzzle flash, splashes) + shake
    ScoringSystem.ts          Pure, unit-tested mission scoring
  world/
    WorldBuilder.ts          Scene lighting/fog + world layout (waypoints, spawns, radar site)
    Ocean.ts, Terrain.ts     Animated ocean plane; islands/hills/props + cheap height field
  ui/
    HUD.ts                   Canvas-drawn retro green HUD, radar scope, landing guidance
    TacticalMap.ts, BriefingScreen.ts, ResultsScreen.ts, ScreenManager.ts (title/pause/settings/loading)
  styles/main.css            Retro CRT/military styling
```

The flight model, mission stage machine, landing evaluation, and scoring are all pure/standalone
enough to be unit-tested without the rendering engine (see `src/test/`).

## Known limitations

- The carrier cannot be damaged or destroyed (out of scope for this mission).
- Enemy AI uses a straightforward finite-state machine (patrol/intercept/attack/evade/disengage)
  tuned for a fair, beatable fight rather than a full tactical simulation.
- Terrain collision uses a cheap analytic height field (cone falloff per landform) rather than
  real mesh collision — visually close to the low-poly geometry but not pixel-perfect.
- Ocean waves are a CPU sine displacement for compatibility/simplicity, not a full FFT ocean sim.
- Speech-synthesis narration of radio messages is best-effort via the browser's
  `speechSynthesis` API when available; subtitles always work regardless.
- Only the current browser session's best score is kept (no persistent storage/leaderboard).
- Tested primarily in Chromium; other evergreen browsers with WebGL2 and Web Audio support should
  work but are not separately verified.
