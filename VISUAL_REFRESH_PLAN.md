# Visual Refresh Plan

Upgrade the rendering presentation of **Operation Broken Beacon** from a primitive
box-and-cylinder prototype into a visually convincing browser flight-combat game, while
leaving the working gameplay systems intact.

Reference implementation studied: [`jeanjerome/OpenSkyFlight`](https://github.com/jeanjerome/OpenSkyFlight)
(source code MIT per its README; see **Licensing** below).

---

## 1. Baseline (Stage 1 — recorded)

Measured on the current `claude/naval-combat-flight-sim-gfmva0` HEAD (`47a42cc`):

| Metric | Value |
| --- | --- |
| Vitest | 32 tests / 5 files, all passing |
| Playwright smoke | 1 test passing |
| `npm run build` | succeeds, 34 modules |
| JS bundle | 596.52 kB (155.69 kB gzip) |
| CSS bundle | 4.37 kB (1.57 kB gzip) |
| `dist/` total | 604 KB |
| Three.js | 0.169.0 (WebGLRenderer) |

Existing mission flow verified working: briefing → catapult launch → waypoint Alpha →
2× Kestrel-9 intercept → waypoint Bravo → radar-site strike → RTB → arrested landing →
results → restart.

### Existing architecture inventory

| # | System | File(s) |
| --- | --- | --- |
| 1 | Entry point | `src/main.ts` |
| 2 | Scene setup | `src/game/Game.ts` ctor + `src/world/WorldBuilder.ts` |
| 3 | Renderer config | `src/game/Game.ts` ctor (bare `WebGLRenderer`, no color mgmt/tone mapping) |
| 4 | Game loop | `src/game/Game.ts` `startLoop`/`fixedUpdate` (fixed 1/60 accumulator) |
| 5 | Player entity | `src/entities/PlayerAircraft.ts` |
| 6 | Flight model | `src/flight/FlightModel.ts`, `src/flight/AircraftController.ts` |
| 7 | Camera system | `src/game/Game.ts` `updateCamera` (simple lerp, 3 modes) |
| 8 | Aircraft geometry | `src/game/AssetFactory.ts` `buildAircraft` (cylinders + extruded wings) |
| 9 | Carrier geometry | `src/game/AssetFactory.ts` `buildCarrier` (boxes) |
| 10 | Terrain/islands | `src/world/Terrain.ts` (cones + cone-falloff height field) |
| 11 | Ocean | `src/world/Ocean.ts` (CPU sine-displaced plane, flat colour) |
| 12 | HUD | `src/ui/HUD.ts` (2D canvas, green monochrome) |
| 13 | Effects | `src/systems/EffectsSystem.ts` (pooled sprites) |
| 14 | Collision volumes | `src/systems/CollisionSystem.ts` (AABB/sphere, carrier local-space) |
| 15 | Build/test | `npm run dev` / `build` / `test` (vitest) / `test:e2e` (playwright) |

---

## 2. Systems that will NOT change (gameplay preserved)

These are working and must keep working. No rewrites:

- `src/flight/FlightModel.ts` — flight physics, stall, lift, drag, weathervane damping
- `src/flight/LandingEvaluator.ts` — pure landing evaluation (unit-tested)
- `src/systems/ScoringSystem.ts` — pure scoring (unit-tested)
- `src/game/MissionManager.ts` — mission stages, radio messages, failure conditions
- `src/entities/EnemyAircraft.ts` — AI finite-state machine (**logic only**; visual swap allowed)
- `src/systems/RadarSystem.ts` — target cycling, lock acquisition
- `src/systems/CombatSystem.ts` — projectile/missile lifecycle and damage application
- `src/game/InputManager.ts` — key mapping and edge detection
- `src/game/AudioManager.ts` — Web Audio synthesis
- `src/ui/BriefingScreen.ts`, `ResultsScreen.ts`, `ScreenManager.ts`, `TacticalMap.ts`
- `src/systems/CollisionSystem.ts` — collision **volumes stay simplified**; detailed visual
  meshes will never feed physics

## 3. Systems that WILL be refactored

| System | Change |
| --- | --- |
| Renderer config | New `src/rendering/RendererSetup.ts`: sRGB output, ACES filmic tone mapping, exposure, shadow config |
| Lighting | Moves from `WorldBuilder` into `src/world/Sky.ts` (sun-driven) |
| Ocean | Replaced by `Water.js`-based `src/world/Ocean.ts` with procedurally generated normal map + low-quality fallback |
| Sky/fog | New `src/world/Sky.ts` using `three/addons/objects/Sky.js` + `FogExp2` |
| Clouds | New `src/world/Clouds.ts` — instanced/sprite clusters driven by a CPU-precomputed FBM noise texture |
| Terrain | `src/world/Terrain.ts` rewritten: noise heightfield mesh, vertex-colour biomes, analytic height query retained for collision |
| Aircraft visuals | New `src/rendering/models/AircraftModel.ts` (detailed procedural); `AssetFactory` becomes fallback provider |
| Carrier visuals | New `src/rendering/models/CarrierModel.ts` with **named attachment points** |
| Cameras | New `src/rendering/CameraRig.ts` — spring damping, speed-based FOV, collision avoidance |
| Cockpit | New `src/rendering/CockpitView.ts` — 3D frame/canopy/panel |
| HUD | `src/ui/HUD.ts` refactored into modular draw units, DPI-correct scaling, warning priority |
| Effects | `src/systems/EffectsSystem.ts` extended: layered explosions, missile flare, impact sparks, debris |
| Entities | Gain `root` / `visual` / `collision` separation without changing their gameplay APIs |
| `Game.ts` | Delegates renderer/camera/quality to new modules; loop structure unchanged |

## 4. OpenSkyFlight concepts referenced (patterns, not files)

| Concept | OSF source | How it is adapted here |
| --- | --- | --- |
| Renderer/scene/camera factory separation | `js/scene/SceneSetup.js` | `src/rendering/RendererSetup.ts` (WebGL, not WebGPU) |
| Sun elevation/azimuth → sun vector; light intensity modulated by `sin(elevNorm·π/2)`; fog colour lerped warm→cool; pre-allocated `Color` objects | `js/atmosphere/AtmosphericSky.js` | `src/world/Sky.ts`, using classic `Sky.js` instead of TSL `SkyMesh` |
| CPU-precomputed FBM noise `DataTexture` instead of per-pixel shader FBM | `js/atmosphere/CloudLayer.js` | `src/world/NoiseTexture.ts`, reused by clouds **and** terrain |
| Critically-damped spring integrator (semi-implicit Euler, `damping = 2√stiffness`) | `js/camera/SpringVector3.js`, `SpringScalar.js` | `src/rendering/Spring.ts` |
| Chase boom: sprung yaw/pitch → Euler(YXZ) → quaternion → rotated offset (gimbal-lock free) | `js/camera/ChaseCameraController.js` | `src/rendering/CameraRig.ts` |
| Adaptive resolution: frame-time ring buffer, min-sample gate, asymmetric up/down steps, epsilon deadband | `js/rendering/AdaptiveQualityManager.js` | `src/rendering/AdaptiveQuality.ts` |
| glTF normalization: bbox → target length scale, recentre, `frustumCulled` control | `js/aircraft/AircraftManager.js` | `src/rendering/AssetLoader.ts` + `ModelTransformConfig` |
| `renderer.info` draw-call/triangle metrics + per-subsystem timers | `js/benchmark/MetricsCollector.js` | `src/rendering/PerformanceMonitor.ts` |
| Centralized tunable constants modules | `js/constants/*.js` | `src/rendering/RenderConstants.ts` |
| Canvas HUD split into per-instrument draw methods | `js/ui/hud/HUDRenderer.js` | `src/ui/HUD.ts` refactor |

## 5. Files expected to change / be added

**New**
```
VISUAL_REFRESH_PLAN.md          VISUAL_REFRESH_CHANGELOG.md      ASSET_GUIDE.md
src/rendering/RendererSetup.ts  src/rendering/RenderConstants.ts src/rendering/GraphicsPresets.ts
src/rendering/AssetLoader.ts    src/rendering/ModelTransform.ts  src/rendering/Spring.ts
src/rendering/CameraRig.ts      src/rendering/PerformanceMonitor.ts
src/rendering/AdaptiveQuality.ts src/rendering/PostProcessing.ts src/rendering/CockpitView.ts
src/rendering/ModelDiagnostics.ts
src/rendering/models/AircraftModel.ts  src/rendering/models/CarrierModel.ts
src/rendering/models/RadarSiteModel.ts src/rendering/models/MissileModel.ts
src/rendering/ProceduralTextures.ts
src/world/Sky.ts   src/world/Clouds.ts   src/world/NoiseTexture.ts
scripts/optimize-assets.mjs
public/assets/{aircraft,ships,structures,environment,textures}/...
src/test/*.test.ts (new suites)
```

**Modified**
```
src/game/Game.ts  src/game/AssetFactory.ts  src/game/GameState.ts
src/world/WorldBuilder.ts  src/world/Ocean.ts  src/world/Terrain.ts
src/entities/{PlayerAircraft,EnemyAircraft,Carrier,GroundTarget,Missile,Projectile}.ts
src/ui/HUD.ts  src/ui/ScreenManager.ts  src/styles/main.css
package.json  README.md  tests/smoke.spec.ts
```

## 6. New dependencies

| Package | Purpose | Risk |
| --- | --- | --- |
| `postprocessing` (runtime) | SMAA / bloom / vignette pipeline | Optional — guarded behind presets; game must run if it fails to init |
| `@gltf-transform/cli` + `@gltf-transform/functions` (dev only) | Future GLB optimization scripts | Dev-only, not shipped |

All Three.js addons (`Sky`, `Water`, `GLTFLoader`, `DRACOLoader`, `KTX2Loader`, `SkeletonUtils`,
`BufferGeometryUtils`) already ship with the installed `three@0.169.0` — **no new runtime dep**.

**No dependency will be added on any remote terrain, imagery, tile, or geocoding service.**

## 7. Licensing considerations — IMPORTANT FINDINGS

Inspection of the OpenSkyFlight repository (shallow clone, HEAD) found:

- **No `LICENSE` file exists in the repository.** The only licence statement is in `README.md`:
  > "This project's source code is licensed under MIT. Map data, imagery, and elevation data are
  > subject to their respective licenses listed above."
- We therefore treat **only the JavaScript source** as MIT, on the strength of that README
  statement, and will add attribution to our README for materially adapted patterns.
- Because no LICENSE file is present, we deliberately **adapt concepts and re-implement in
  TypeScript** rather than copying files verbatim. No OSF file is copied into this repo.

**Explicitly excluded (must NOT be copied or depended on):**

| Asset / service | Terms found | Action |
| --- | --- | --- |
| Dassault Rafale B GLB + texture (`assets/models/rafale/`) | CGTrader "Royalty Free License" — not redistributable | **Excluded.** We ship original fictional aircraft. |
| Esri World Imagery satellite tiles | Proprietary; commercial use requires paid licence | **Excluded.** No satellite imagery. |
| OpenStreetMap tiles | ODbL / CC-BY-SA 2.0, tile-usage policy | **Excluded.** No map tiles. |
| Mapzen / AWS Terrain Tiles elevation | Mixed open data, attribution required | **Excluded.** Terrain is locally procedural. |
| Nominatim geocoding | ODbL + usage policy | **Excluded.** Not used. |
| `vendor/three-tile` | Third-party vendored lib | **Excluded.** Not used. |

All aircraft, ships, structures, terrain, textures and effects in this project remain
**original and procedurally generated at runtime**, with no external asset downloads.

## 8. Major risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Carrier remodel breaks launch/landing detection | Attachment points become **named `Object3D`s** on the model; `CARRIER_LOCAL` constants derived from them; landing unit tests + live playthrough |
| Terrain rewrite misaligns radar site / waypoints | Radar site is **snapped to the sampled terrain height**; `getHeightAt()` contract preserved; waypoint positions unchanged |
| `Water.js` cost at large view distances | Reduced reflector resolution, distance-capped water mesh, plain-material fallback in Low preset |
| Tone mapping / sRGB washes out the retro HUD | HUD is a **separate 2D canvas overlay**, unaffected by tone mapping |
| Postprocessing instability or bundle bloat | Feature-detected and wrapped in try/catch; disabled in Low preset; plain `renderer.render` fallback path retained |
| Shadows tank framerate | Shadow casting limited to player, near enemies, carrier deck, key structures; tight shadow-camera bounds |
| Adaptive quality oscillation | Asymmetric step sizes + epsilon deadband + min-sample gate (OSF pattern), unit-tested for hysteresis |
| Scope creep across 10 stages | Stage-gated: gameplay smoke-checked after each stage; prefer a simpler reliable version over an unstable advanced one |

## 9. Staged acceptance criteria

| Stage | Done when |
| --- | --- |
| 1 Baseline | Metrics recorded; plan committed; tests+build green |
| 2 Rendering foundation | sRGB + ACES + exposure active; presets selectable; perf overlay shows FPS/draw calls/triangles; mission still completable |
| 3 Asset architecture | `AssetLoader` caches + falls back; missing GLB logs a warning and still starts the mission; entity root/visual/collision split in place; `ASSET_GUIDE.md` written |
| 4 Aircraft | Player jet visibly non-blocky (curved fuselage, blended roots, nacelles, gear, lights); enemy has distinct silhouette; cannon/missile origins and radar lock still correct |
| 5 Carrier | Angled deck, island, mast, markings, lights present; all named attachment points resolve; catapult launch and arrested landing verified in a live run |
| 6 Environment | Sky gradient with sun + haze (no hard horizon line); animated reflective ocean; volumetric-looking clouds; terrain with coastline/hills/ridges and biome colouring; waypoints and ground target still reachable |
| 7 Cameras/HUD | Chase cam damped without float; FOV widens under afterburner; cockpit frame present; HUD readable at 1080p and 1440p; aiming still practical |
| 8 Effects | Layered explosion (flash/fire/smoke/debris), missile flare + trail, tracer impacts, damage smoke; optional bloom/SMAA toggleable |
| 9 Optimization | Adaptive resolution within bounds; presets change measurable cost; no per-frame allocation hot spots; asset scripts present |
| 10 Regression | Full mission playthrough clean; all tests pass; production build succeeds; README attribution + changelog complete |

## 10. Working rules for this refresh

- Gameplay state stays separate from visual state; visuals read simulation, never drive it.
- Physics never reads visual mesh vertices.
- Every new visual system degrades gracefully to a cheap fallback.
- No OSF file copied; patterns re-implemented in TypeScript with attribution.
- Progress recorded per stage in `VISUAL_REFRESH_CHANGELOG.md`.
