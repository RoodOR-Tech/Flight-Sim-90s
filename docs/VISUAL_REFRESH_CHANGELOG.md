# Visual Refresh Changelog

Running record of the staged visual/rendering refresh described in `VISUAL_REFRESH_PLAN.md`.

---

## Stage 1 — Baseline and regression protection

**Files changed:** `VISUAL_REFRESH_PLAN.md` (new)

**Behaviour changed:** none.

**Reference concepts used:** inspected the OpenSkyFlight repository (shallow clone) for licence terms
and for the modules named in the plan.

**Tests performed:** existing suite (32 tests / 5 files) green; `npm run build` green.

**Baseline recorded:** JS 596.52 kB (155.69 kB gzip), CSS 4.37 kB, `dist/` 604 KB, three@0.169.0.

**Known limitations / findings:**
- OpenSkyFlight has **no `LICENSE` file**; the only statement is "source code is licensed under MIT"
  in its README. We therefore adapted *concepts* and re-implemented in TypeScript rather than copying
  files, and recorded attribution.
- Confirmed restricted assets to avoid: Dassault Rafale GLB (CGTrader royalty-free, non-redistributable),
  Esri satellite imagery (proprietary), OSM tiles (ODbL/CC-BY-SA), Mapzen terrain tiles, Nominatim,
  vendored `three-tile`. None are used.

---

## Stage 2 — Rendering foundation

**Files changed:** `src/rendering/RenderConstants.ts`, `GraphicsPresets.ts`, `RendererSetup.ts`,
`AdaptiveQuality.ts`, `PerformanceMonitor.ts`, `Spring.ts`, `CameraRig.ts`, `ProceduralTextures.ts` (all new);
`src/game/GameState.ts`, `src/game/Game.ts`, `src/styles/main.css`.

**Behaviour changed:**
- sRGB output, ACES filmic tone mapping and an exposure control replace the previous bare renderer.
- Low / Medium / High / Automatic graphics presets, applied through every subsystem.
- Dynamic resolution scaling with hysteresis.
- Developer performance overlay (FPS, frame time, pixel ratio, draw calls, triangles, particles,
  missiles, terrain detail, per-subsystem timings).
- All textures are now generated at runtime (canvas / `DataTexture`), deterministically seeded.

**Reference concepts used:** OpenSkyFlight `js/scene/SceneSetup.js` (factory split),
`js/rendering/AdaptiveQualityManager.js` (frame-time ring buffer, min-sample gate, asymmetric
up/down steps, epsilon deadband), `js/benchmark/MetricsCollector.js` (`renderer.info` sampling,
subsystem timers), `js/constants/*.js` (centralized tunables).

**Performance impact:** neutral to positive; Low preset measurably cheaper (no shadows, no
reflections, no postprocessing, DPR capped at 1).

**Known limitations:** water reflectivity and terrain mesh density are baked at construction, so
changing those presets takes effect on the next mission start rather than instantly.

---

## Stage 3 — Asset architecture

**Files changed:** `src/rendering/AssetLoader.ts`, `ModelTransform.ts`, `ModelRegistry.ts`,
`ModelDiagnostics.ts` (all new); `src/game/AssetFactory.ts` (trimmed to scenery only);
`ASSET_GUIDE.md` (new); `public/assets/**` (directory scaffold); `scripts/optimize-assets.mjs` (new);
`package.json` (asset scripts).

**Behaviour changed:**
- Centralized loader with GLB/glTF support, Draco / KTX2 / Meshopt decoders (all feature-detected),
  a model cache, `SkeletonUtils`-based cloning for rigged assets, and texture caching.
- **Every asset slot has a mandatory procedural fallback.** `loadModel` never rejects: a missing or
  broken file logs a clear warning and returns the fallback, so the mission always starts.
- Declarative `ModelTransformConfig` per slot (scale / rotation in degrees / offset), plus bounding-box
  normalization to a target length with a unit-mismatch warning.
- Loading screen reports real initialization stages.
- Development-only model diagnostics (mesh/triangle/material/texture counts, largest textures,
  missing normals or UVs, unlit or transparent materials, suspect scale).

**Reference concepts used:** OpenSkyFlight `js/aircraft/AircraftManager.js` (GLTF load, bbox → target
length scaling, recentring, `frustumCulled` handling).

**Tests performed:** new `assetLoader.test.ts` (8) and `modelTransform.test.ts` (11).

**Known limitations:** gameplay attachment points are deliberately **not** read from external models —
an imported GLB replaces appearance only. Documented in `ASSET_GUIDE.md`.

---

## Stage 4 — Aircraft

**Files changed:** `src/rendering/models/LoftBuilder.ts`, `AircraftModel.ts`, `MissileModel.ts` (new);
`src/entities/PlayerAircraft.ts`, `EnemyAircraft.ts`, `Missile.ts`.

**Behaviour changed:**
- Both airframes are rebuilt from lofted superellipse cross-sections and NACA-section wings, so
  fuselages are genuinely curved and shade smoothly instead of reading as cylinders and boxes.
- **Sea Viper** (player): chined forebody, radome, leading-edge root extensions, blended wing roots,
  twin canted fins, all-moving tailerons, paired side intakes with dark inlet faces, twin nacelles
  with serrated nozzles, bubble canopy over a cockpit tub and seat, tricycle gear with oleo struts
  and doors, arresting hook, four missile pylons with captive rounds, nav lights with tail strobe.
- **Kestrel-9** (hostile): a deliberately different silhouette — area-ruled "wasp waist", single chin
  intake, canards, cropped delta wing with anhedral, single tall fin with red trim, ventral strakes,
  one large nozzle. Not a recolour.
- Entity structure is now `root` (gameplay transform) → `visualRoot` → model, with a separate simple
  collision sphere. Physics never reads visual geometry.
- Control surfaces deflect from the live control inputs; gear and flaps animate; afterburner plumes
  flicker; damaged aircraft trail smoke and sparks.

**Behaviour intentionally preserved:** the enemy AI state machine is untouched.

**Performance impact:** higher triangle count per aircraft, offset by shared geometry/materials for
missiles and by shadow-casting being limited to opaque parts.

---

## Stage 5 — Carrier

**Files changed:** `src/rendering/models/CarrierModel.ts` (new); `src/entities/Carrier.ts`.

**Behaviour changed:**
- Extruded chamfered hull with a raked bow and squared stern; main deck plus a **canted angled
  landing deck** and its port sponson; deck-edge coaming; elevator outlines.
- Tiered island with glazed bridge and pri-fly bands, lattice mast, rotating air-search array, whip
  antennae, close-in weapon mounts.
- Deck surface uses a generated texture with non-skid wear, centreline, catapult track, landing-area
  lines, arresting-wire hashes and a red foul line. Deck-edge lights (red port / green starboard),
  approach lights, and an optical landing system datum.
- Tapered translucent wake.
- **All nine named attachment points** (`catapultStart`, `catapultEnd`, `landingZoneStart`,
  `landingZoneCenter`, `landingZoneEnd`, `arrestingPoint`, `lineupReference`, `glideSlopeReference`,
  `carrierRadar`) are real `Object3D` children, and `CARRIER_LOCAL` is now *derived* from them so the
  visual model and the gameplay reference frame cannot drift apart.

**Tests performed:** new `carrierAttachments.test.ts` (9) asserts every point exists, the ordering is
correct, heights match the deck, and world-space transforms follow the ship.

---

## Stage 6 — Environment

**Files changed:** `src/world/Sky.ts`, `Clouds.ts`, `TerrainField.ts`, `WorldLayout.ts` (new);
`src/world/Ocean.ts`, `Terrain.ts`, `WorldBuilder.ts`.

**Behaviour changed:**
- **Sky:** Three's `Sky` shader with sun elevation/azimuth, turbidity and Rayleigh tuning; the dome is
  excluded from fog so the horizon no longer reads as a hard line. `FogExp2` haze whose colour lerps
  from warm to cool with sun height; sun and hemisphere light intensity both driven by the sun angle.
  The dome and the shadow frustum follow the player.
- **Ocean:** Three's `Water` (planar reflection + animated normal distortion) fed by a
  **procedurally generated normal map**, so no third-party water texture is needed. Cheap animated
  standard-material fallback on Low. The plane follows the camera; because `Water` samples noise in
  world space the wave pattern stays anchored.
- **Clouds:** scattered formations of camera-facing sprite clusters using generated puffy textures
  with fully transparent borders (no visible sprite rectangles). They drift and wrap around the player.
- **Terrain:** rewritten as a noise heightfield — layered FBM for hills plus ridged multifractal for
  crests, a smooth coastline falloff, and a flattened plateau for the radar station. Per-vertex biome
  colouring by elevation and slope (sand → grass → dry grass → rock → bare high rock). One main island
  with six outlying islets, a coastal settlement, radio mast and boats.
- The radar site is seated on the sampled terrain height, so it never floats or sinks.
- `getHeightAt` delegates to the same pure field that generated the mesh, so **collision matches what
  you can see**.

**Reference concepts used:** OpenSkyFlight `js/atmosphere/AtmosphericSky.js` (sun vector from
elevation/azimuth, `sin(elevNorm·π/2)` light ramp, warm→cool fog lerp with pre-allocated colours) and
`js/atmosphere/CloudLayer.js` (CPU-precomputed FBM noise into a texture instead of per-pixel FBM).

**Known limitations:** ocean waves are visual only — sea level stays a flat plane at y=0 for gameplay.

---

## Stage 7 — Cameras, cockpit and HUD

**Files changed:** `src/rendering/CameraRig.ts`, `CockpitView.ts`; `src/ui/HUD.ts`,
`src/ui/ScreenManager.ts`, `src/styles/main.css`, `src/game/GameState.ts`.

**Behaviour changed:**
- Critically-damped spring camera with speed- and afterburner-driven FOV, partial roll following
  (horizon stays readable), look-ahead aim point, terrain/sea clearance clamping, and immediate
  snapping on mode change.
- Simplified 3D cockpit: glare shield and instrument panel across the bottom, canopy rails at the
  side edges, windscreen bow and corner gussets at the top, dim backlit displays, a soft canopy
  reflection, and a damage tint that only appears when badly hurt. Optional cockpit vibration
  (afterburner / low-altitude buffet / damage), applied to the cockpit rather than the camera.
- HUD: contrast scrims behind the data columns plus drop shadows on every glyph, so the green stays
  readable over sun glint and pale sky. The old 2D cockpit frame was removed in favour of the real
  3D one.
- New settings: graphics preset, performance overlay, chase-camera damping, speed-based FOV,
  reduced motion.

**Reference concepts used:** OpenSkyFlight `js/camera/SpringVector3.js` / `SpringScalar.js`
(critically-damped semi-implicit spring, `damping = 2√stiffness`), `js/camera/ChaseCameraController.js`
(boom offset rotated by a quaternion built from sprung angles, avoiding gimbal lock),
`js/ui/hud/HUDRenderer.js` (per-instrument draw methods).

**Bugs found and fixed during this stage:**
1. **Chase camera lagged ~70 m behind at speed**, pushing the aircraft out of frame in cinematic view.
   Cause: springing the camera's *world position* gives a steady-state error of `2v/√k`, which is
   large at 300+ kt. Fixed by springing the aircraft-relative **boom offset** instead — it only
   changes when the aircraft rotates, so there is no translational lag at any speed.
2. **HUD readouts became invisible.** The new contrast scrim left a canvas gradient as the active
   `fillStyle`, and several labels drew with the inherited fill. Fixed with `save`/`restore` plus an
   explicit fill per label group.
3. **Cockpit geometry was wildly oversized** — parts with depth passing close to the eye swallowed a
   third of the screen. Rebuilt as flat quads at a single fixed depth, sized from the frustum
   half-extents, so on-screen coverage is exact and predictable.

---

## Stage 8 — Effects and postprocessing

**Files changed:** `src/systems/EffectsSystem.ts`; `src/rendering/PostProcessing.ts` (new);
`src/entities/Missile.ts`, `Projectile.ts`; `src/game/Game.ts`.

**Behaviour changed:**
- Layered explosions: white-hot flash → expanding fireball cooling yellow→red → dark rising smoke →
  tumbling debris that splashes on hitting the sea, plus screen shake.
- Missiles: lofted ogive body with seeker, band, cruciform fins and mid-body wings; flickering
  additive motor flare that dies when the motor burns out, then the round coasts; layered smoke trail.
- Cannon: muzzle flash, impact sparks with a bright core, ground dust, water splash.
- Damage: progressive engine smoke that darkens with severity, intermittent sparks, directional
  damage indicator, cockpit damage overlay.
- Particles are pooled with per-particle drag, buoyancy, spin and colour ramps; counts scale with the
  quality preset and the pool is a hard bound.
- Optional `postprocessing` pipeline (SMAA + restrained bloom + vignette), dynamically imported and
  fully guarded — any failure falls back to direct rendering.

**Performance impact:** postprocessing splits into a separate 321 kB chunk, loaded only when enabled.
Disabled entirely on Low.

---

## Stage 9 — Optimization and asset tooling

**Files changed:** `src/rendering/AdaptiveQuality.ts`, `PerformanceMonitor.ts`,
`scripts/optimize-assets.mjs`, `package.json`, `src/game/Game.ts`.

**Behaviour changed:**
- Dynamic resolution active during gameplay only, with a cooldown so it settles instead of flapping.
- Render loop reuses scratch vectors/quaternions and a persistent camera-rig input object — no
  per-frame allocation in the hot path.
- Shared geometry and materials for missiles, particles and debris; shadow casting restricted to the
  player, near enemies, the carrier superstructure and key structures.
- WebGL context-loss and context-restored handling (pauses, then reapplies renderer state).
- `npm run assets:inspect` / `assets:optimize` / `assets:optimize:dry`. The optimizer is
  non-destructive (writes to `public/assets-optimized/`) and degrades cleanly when the optional
  glTF-Transform toolkit or encoders are absent.

**Tests performed:** `adaptiveQuality.test.ts` (12) covers bounds, hysteresis, cooldown, and
non-oscillation between thresholds.

---

## Stage 10 — Regression pass and documentation

**Files changed:** `tests/smoke.spec.ts`; new `src/test/{flightModel,aircraftController,carrierLanding,
graphicsPresets,adaptiveQuality,assetLoader,modelTransform,carrierAttachments}.test.ts`;
`src/flight/FlightModel.ts`; `src/systems/CollisionSystem.ts`; `src/game/Game.ts`;
`src/game/MissionManager.ts`; `README.md`; this changelog.

**Behaviour changed:** see the three gameplay bugs below.

**Tests performed:**
- Unit: **113 tests / 13 files**, all passing (baseline was 32 / 5).
- Browser: **3 Playwright tests**, all passing — boot → briefing → mission start → scene assertions
  (player, carrier and radar site actually present, aircraft airborne and moving) → camera cycling →
  tactical map → restart without reload; the full catapult launch sequence; and the settings panel.
- Automated flight runs (throwaway harnesses, not committed) drove the mission via keyboard input and
  the read-only test-state hook, verifying stage progression launch → Alpha → intercept → enemy
  engagement, and a full recovery approach down to the deck.

**Gameplay bugs found and fixed during the regression pass:**

1. **Bank angle was reported wrongly.** `getRollDegrees()` normalized the horizontal component before
   feeding `atan2`, forcing the denominator to 1 — a true 45° bank read as 35°. This corrupted the HUD
   horizon and the chase-camera roll follow. Fixed to use the un-normalized horizontal magnitude.

2. **Banking did not turn the aircraft at all.** Verified by measurement: a sustained 32° bank produced
   **0.0° of heading change** over three seconds. The weathervane damping that makes the aircraft fly
   where it points also cancelled the sideslip that a banked lift vector would have produced, so
   attitude changed and nothing else. Added an explicit coordinated-turn term (`g·tan(bank)/V` about
   the world up axis, with an arcade responsiveness factor, clamped rather than cut off past vertical
   so there is no dead zone at steep bank). Turn rate is now ≈12°/s at 45° bank.
   *This is a pre-existing bug, not a regression from the refresh.*

3. **The G (gear) and F (flaps) keys were never wired up.** `toggleGear`/`toggleFlaps` existed on the
   controller but nothing called them; the keys were mapped and documented but did nothing. Because a
   successful trap requires gear down, and the "Skip Carrier Launch" start sets gear up, **the mission
   was unwinnable in skip-launch mode.** Now wired, with an audio cue and a radio callout.
   *Also pre-existing — present in the original commit.*

Additionally, the deck capture ceiling was raised from 6 m to 9 m above the deck datum so a slightly
high touchdown still traps, matching the brief's "forgiving landing" requirement.

**Final build:** JS 860.37 kB (240.54 kB gzip) main + 321.48 kB (112.70 kB gzip) postprocessing chunk,
CSS 4.99 kB (1.72 kB gzip), `dist/` 1.3 MB. Build emits no warnings.

**Known limitations:**
- The automated flight harness flies a good approach but does not reliably plant the aircraft inside
  the 48 m arresting zone; the landing decision is instead verified by 16 deterministic unit tests
  covering deck contact, zone bounds and every rejection reason across carrier headings.
- Headless verification runs on SwiftShader, so screenshots confirm composition rather than GPU-exact
  output.
- Water reflectivity and terrain density changes apply on the next mission start.
- The carrier still cannot be damaged (unchanged, out of scope).
