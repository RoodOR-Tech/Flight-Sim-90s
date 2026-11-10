# Operation Broken Beacon

A complete, playable single-player 3D naval combat flight-simulator mission for the browser, built
with TypeScript, Vite and Three.js. It keeps the accessible feel and presentation of a mid-1990s
carrier-aviation combat sim — straightforward controls, a green monochrome HUD, radar interception,
missile combat, mission objectives and radio chatter — over a modern rendering pipeline.

> **Originality statement:** This is an original game inspired only by the broad conventions of 1990s
> combat-flight simulators. It contains **no code, artwork, text, audio or design assets copied from
> U.S. Navy Fighters Gold** or any other commercial title. Every aircraft, ship, structure, terrain
> surface, texture, sound and line of dialogue is original and generated procedurally at runtime.

---

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens a Vite dev server (default `http://localhost:5173`). No backend, API keys, accounts or external
services are required — everything runs client-side and fully offline.

## Production build

```bash
npm run build
npm run preview   # serve the production build locally
```

## Tests

```bash
npm test          # Vitest unit tests
npm run test:e2e  # Playwright browser smoke tests (run `npm run build` first; needs Chromium: `npx playwright install chromium`)
```

Unit coverage includes: score calculation, missile-lock eligibility, mission-stage progression,
landing-condition evaluation, damage clamping, flight-model bank/turn behaviour, gear and flap
toggling, carrier attachment-point alignment, arrested-landing decisions, graphics presets,
adaptive-resolution bounds and hysteresis, asset-cache and fallback behaviour, and model-transform
normalization.

## Optional asset tooling

```bash
npm run assets:inspect       # inspect a GLB with glTF-Transform (if installed)
npm run assets:optimize      # optimize any GLBs under public/assets -> public/assets-optimized
npm run assets:optimize:dry  # report only, write nothing
```

The game ships with **no GLB files**. Supplied GLBs are currently validated and reported on but not
yet rendered in-game — see the status note at the top of `ASSET_GUIDE.md`.

---

## The mission

**Operation Broken Beacon** — hostile "Kestrel-9" fighters are massing near a coastal early-warning
radar station that is vectoring them toward the carrier group. You fly **Viper One**, a Sea Viper
naval interceptor launching from **CVN Resolute**:

1. Launch from the carrier catapult.
2. Navigate to waypoint **ALPHA**.
3. Intercept and destroy **two** Kestrel-9 fighters.
4. Navigate to waypoint **BRAVO** and destroy the coastal **radar site** (only a valid target once
   both fighters are down).
5. Return to CVN Resolute and land.
6. Review your mission score.

Civilian structures near the coast must not be engaged — one accidental hit is a warning, repeated
hits fail the mission.

## Controls

| Key | Action |
| --- | --- |
| W / S | Pitch down / pitch up |
| A / D | Roll left / right |
| Q / E | Yaw left / right |
| Arrow keys | Alternate flight controls (Up = pitch down, Down = pitch up, like W / S) |
| Shift | Increase throttle |
| Ctrl | Decrease throttle |
| B | Afterburner |
| Space | Fire cannon |
| R | Fire locked missile |
| T | Cycle radar target |
| L | Hold to acquire radar lock |
| G | Toggle landing gear |
| F | Toggle flaps |
| C | Cycle camera (chase / cockpit / cinematic) |
| M | Toggle tactical map |
| P | Pause |
| Escape | Pause / menu |
| Enter | Advance briefing / confirm |

Mouse movement gives a look-around offset in cockpit and chase views. A **Skip Carrier Launch**
checkbox on the briefing starts you airborne.

## Gameplay tips

- **Turn by banking.** Roll with A/D and hold the bank — the aircraft turns on its own, faster at
  steeper bank and lower speed. Add a little back-stick (S) to hold altitude through the turn.
- The aircraft has momentum and does not fly like a camera. Ease the nose up out of a dive rather
  than yanking it.
- Missiles need a completed radar lock: cycle a target with **T**, hold **L** until `RADAR LOCK`
  appears, then fire with **R**. A `SHOOT` cue confirms a valid firing solution.
- The cannon is unguided with a short effective range — get inside ~400 m and lead the target.
- Watch the radar scope (bottom right) and the tactical map (**M**) for bogeys, the carrier, the
  radar site and your waypoint.
- **Landing:** gear down (**G**), flaps down (**F**), line up with the deck, ease down to roughly
  60–75 m/s with a gentle sink rate, and touch down in the arresting zone. The landing-guidance box
  near the top of the HUD shows lineup and glide slope, and warns you off a bad approach.
- If performance is poor, set Settings → Quality Preset to **Low**. Leave it on **Automatic** to let
  the game scale resolution to your hardware.

## Settings

Graphics preset (Automatic / Low / Medium / High), performance overlay, mouse sensitivity,
chase-camera damping, speed-based FOV, reduced screen shake, reduced motion, mute, FPS counter and
enemy difficulty (Easy / Normal / Hard). Difficulty changes enemy health, reactions and fire rate
and how much damage you take. Settings and your best score are saved in the browser's local storage.

---

## Architecture

```text
src/
  main.ts                       Entry point
  game/
    Game.ts                     Main loop, screen state machine, system wiring
    GameState.ts                Cross-screen settings and session state
    MissionManager.ts           Mission stages, radio messages, failure conditions
    InputManager.ts             Keyboard/mouse input, edge-triggered actions
    AudioManager.ts             Web Audio-synthesized sound effects (no audio files)
    AssetFactory.ts             Small procedural scenery props
    Constants.ts / Types.ts     Shared tunables and interfaces
  flight/
    FlightModel.ts              Arcade lift/thrust/drag physics, coordinated banked turn
    AircraftController.ts       Health, gear/flap state, mesh sync
    LandingEvaluator.ts         Pure carrier-landing evaluation
  entities/
    PlayerAircraft.ts  EnemyAircraft.ts  Missile.ts  Projectile.ts
    Carrier.ts         GroundTarget.ts
  systems/
    CombatSystem.ts             Projectile/missile lifecycle, hit detection, damage
    RadarSystem.ts              Target cycling, radar-lock acquisition
    CollisionSystem.ts          Terrain/ocean/carrier/aircraft collision volumes
    EffectsSystem.ts            Pooled particles, debris, screen shake
    ScoringSystem.ts            Pure mission scoring
  rendering/
    RendererSetup.ts            Renderer/scene/camera factories, colour management
    RenderConstants.ts          Centralized rendering tunables
    GraphicsPresets.ts          Low/Medium/High/Automatic quality presets
    AdaptiveQuality.ts          Dynamic resolution with hysteresis
    PerformanceMonitor.ts       Frame metrics and developer overlay
    PostProcessing.ts           Optional SMAA + bloom + vignette (guarded)
    CameraRig.ts  Spring.ts     Spring-damped cameras, speed-driven FOV
    CockpitView.ts              Simplified 3D cockpit frame
    AssetLoader.ts              GLB/texture loading, caching, mandatory fallbacks
    ModelTransform.ts           Declarative orientation/scale correction
    ModelRegistry.ts            Optional external model slots + fallbacks
    ModelDiagnostics.ts         Development model inspection
    ProceduralTextures.ts       All runtime-generated textures
    models/
      LoftBuilder.ts            Cross-section lofting + NACA airfoil wing generator
      AircraftModel.ts          Sea Viper and Kestrel-9 airframes
      CarrierModel.ts           CVN Resolute + named attachment points
      RadarSiteModel.ts  MissileModel.ts
  world/
    WorldBuilder.ts             Environment assembly
    WorldLayout.ts              Fixed mission geography
    Sky.ts                      Atmosphere, sun, haze
    Ocean.ts                    Reflective water + cheap fallback
    Clouds.ts                   Sprite-cluster cloud formations
    Terrain.ts  TerrainField.ts Noise heightfield, biome colouring, collision query
  ui/
    HUD.ts                      Canvas HUD, radar scope, landing guidance
    TacticalMap.ts  BriefingScreen.ts  ResultsScreen.ts  ScreenManager.ts
  styles/main.css               Retro CRT/military styling
```

**Design rules the code follows:**

- Gameplay state and visual state are separate. Each entity has a `root` transform that gameplay
  writes; detailed visuals are children of it.
- Physics never reads visual mesh vertices — collision uses simple spheres and boxes.
- Terrain collision queries the *same* pure height function that generated the mesh, so what you see
  is what you can crash into.
- Carrier launch/landing reference points are named `Object3D`s on the model, and the gameplay
  constants are derived from them, so the two cannot drift apart.
- Every visual subsystem degrades to a cheap fallback, and every optional asset has a procedural one.

## Attribution

This project's rendering architecture adapts several **patterns** (not files) from
[**OpenSkyFlight**](https://github.com/jeanjerome/OpenSkyFlight) by Jean Jerome, whose README states
its source code is licensed under **MIT**. No OpenSkyFlight file is copied into this repository; the
concepts below were studied and re-implemented in TypeScript for this codebase:

| Concept adapted | OpenSkyFlight source |
| --- | --- |
| Renderer / scene / camera factory separation | `js/scene/SceneSetup.js` |
| Sun vector from elevation & azimuth; light intensity ramped by `sin(elevNorm·π/2)`; warm→cool exponential fog lerp with pre-allocated colours | `js/atmosphere/AtmosphericSky.js` |
| CPU-precomputed FBM noise baked into a texture instead of per-pixel shader FBM | `js/atmosphere/CloudLayer.js` |
| Critically-damped spring integrator (`damping = 2√stiffness`, semi-implicit Euler) | `js/camera/SpringVector3.js`, `SpringScalar.js` |
| Chase boom placed by rotating a fixed offset with a quaternion built from sprung angles (gimbal-lock free) | `js/camera/ChaseCameraController.js` |
| Adaptive resolution: frame-time ring buffer, minimum-sample gate, asymmetric up/down steps, epsilon deadband | `js/rendering/AdaptiveQualityManager.js` |
| glTF normalization: bounding box → target length, recentre, `frustumCulled` handling | `js/aircraft/AircraftManager.js` |
| `renderer.info` draw-call/triangle metrics with per-subsystem timers | `js/benchmark/MetricsCollector.js` |
| Canvas HUD split into per-instrument draw methods | `js/ui/hud/HUDRenderer.js` |
| Centralized named-constant modules | `js/constants/*.js` |

**Deliberately not used.** OpenSkyFlight's non-code assets and data services are excluded because
their terms do not permit redistribution here, and because this game is designed to run offline:

- the Dassault Rafale GLB and its texture (CGTrader royalty-free licence — not redistributable);
- Esri World Imagery satellite tiles (proprietary);
- OpenStreetMap map tiles (ODbL / CC-BY-SA, plus tile-usage policy);
- Mapzen / AWS terrain elevation tiles;
- Nominatim geocoding;
- the vendored `three-tile` library.

No remote terrain, imagery, tile or geocoding service is contacted at any point.

Third-party libraries: [Three.js](https://threejs.org/) (MIT), including its `Sky`, `Water`,
`GLTFLoader`, `DRACOLoader`, `KTX2Loader`, `SkeletonUtils` and `meshopt_decoder` addons; and
[`postprocessing`](https://github.com/pmndrs/postprocessing) (Zlib) for the optional SMAA/bloom/vignette pass.

## Known limitations

- The carrier cannot be damaged or destroyed (out of scope for this mission).
- Enemy AI is a straightforward finite-state machine (patrol / intercept / pursue / attack / evade /
  disengage) tuned for a fair, beatable fight rather than a tactical simulation.
- Terrain collision uses the analytic height field rather than mesh raycasting — it matches the
  visible surface but is not per-triangle exact.
- Ocean waves are visual only; sea level is a flat plane at y = 0 for gameplay purposes.
- Water reflectivity and terrain mesh density are chosen when the world is built, so changing those
  quality settings takes effect on the next mission start.
- The banked turn uses an arcade responsiveness multiplier on the physical `g·tan(bank)/V` rate;
  it is deliberately more responsive than a true-to-life airliner-style turn.
- Speech-synthesis narration of radio messages is best-effort via the browser's `speechSynthesis`
  API where available; subtitles always work regardless.
- Only the current browser session's best score is kept (no persistent storage).
- Verified primarily in Chromium. Other evergreen browsers with WebGL2 and Web Audio should work but
  are not separately tested.
- Headless test runs use SwiftShader software rendering, so automated screenshots confirm composition
  rather than GPU-exact output.
