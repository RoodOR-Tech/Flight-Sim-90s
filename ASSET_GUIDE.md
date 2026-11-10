# Asset Guide

**Operation Broken Beacon ships with no external asset files.** Every aircraft, ship, structure,
terrain surface, texture and sound is generated procedurally at runtime from Three.js primitives,
custom `BufferGeometry`, canvas-drawn textures and the Web Audio API.

This guide exists for the optional case where you want to *replace* a procedural model with an
authored one.

> **Current status — not yet rendered in-game.** The loader finds, validates, normalizes and (in dev
> builds) reports on a correctly named file dropped into the right folder, but the live entities are
> still built from the procedural models, because gameplay depends on their attachment points
> (hardpoints, engine and damage points, catapult and arresting-wire positions). Dropping in a GLB
> today gets you the diagnostics report, not a visual swap. Wiring a GLB's visuals onto the
> procedural attachment rig is the remaining step. A missing or broken file never blocks the mission.

---

## Directory structure

```text
public/
  assets/
    aircraft/
      sea-viper/      sea-viper.glb        <- player interceptor
      kestrel-9/      kestrel-9.glb        <- hostile fighter
    ships/
      cvn-resolute/   cvn-resolute.glb     <- the carrier
    structures/
      radar-site/     radar-site.glb       <- coastal radar installation
    environment/                            <- optional environment maps
    textures/                               <- optional replacement textures
```

Optimized output from `npm run assets:optimize` is written to `public/assets-optimized/`
(the source files are never overwritten).

## Supported formats

| Kind | Formats | Notes |
| --- | --- | --- |
| Models | `.glb` (preferred), `.gltf` | `.glb` keeps everything in one file |
| Geometry compression | Draco, Meshopt | Both optional; decoders are feature-detected |
| Texture compression | KTX2 / Basis, WebP, PNG, JPG | KTX2 needs the transcoder present; otherwise use PNG/WebP |
| Textures | PNG, JPG, WebP | Colour maps must be sRGB; normal/roughness maps must be linear |

Compression is genuinely optional. If a decoder is unavailable the loader logs a warning and falls
back — it never hard-fails.

## Coordinate convention

The game uses a right-handed Y-up frame:

| Axis | Direction |
| --- | --- |
| **-Z** | **Forward** (aircraft nose, ship bow) |
| **+Y** | Up |
| **+X** | Right / starboard |

Units are **metres**. Most DCC tools export aircraft nose-toward `+Z`, so the registry applies a
180° yaw by default — see `src/rendering/ModelRegistry.ts`.

If your model needs a different correction, edit its `transform` there rather than compensating
elsewhere in the code:

```ts
transform: makeTransform({
  scale: 1,
  rotation: { x: 0, y: 180, z: 0 },   // degrees, XYZ order
  offset:   { x: 0, y: 0,   z: 0 },   // metres, applied after rotation/scale
})
```

## Scale and origin

Each slot declares a `targetLength` (metres along the model's longest axis). On load the model is
scaled to match and recentred on its bounding-box centre, so the exact size you export is not
critical — but the *proportions* are.

| Slot | Target length | Origin should be |
| --- | --- | --- |
| `sea-viper` | 9.2 m | Centre of mass, roughly at the wing root |
| `kestrel-9` | 10.0 m | Centre of mass |
| `cvn-resolute` | 280 m | Waterline amidships |
| `radar-site` | 34 m | Centre of the concrete pad, at ground level |

The loader warns if the required scale factor exceeds 50× or falls below 0.02×, which almost always
means a centimetre/inch unit mismatch.

## Recommended budgets

Conservative targets for smooth play on integrated graphics:

| Asset | Triangles | Textures | Materials |
| --- | --- | --- | --- |
| Player aircraft | ≤ 25,000 | 1–2 × 1024² | ≤ 4 |
| Enemy aircraft | ≤ 20,000 | 1–2 × 1024² | ≤ 4 |
| Carrier | ≤ 45,000 | 2–3 × 2048² | ≤ 6 |
| Radar site | ≤ 12,000 | 1 × 1024² | ≤ 3 |
| Small props | ≤ 2,000 | shared atlas | 1 |

Keep textures at 2048² or smaller. Prefer one packed material over many small ones — draw calls cost
more than triangles here.

## Naming conventions

- Files: lower-kebab-case matching the folder (`sea-viper.glb`).
- Meshes: `fuselage`, `wing_left`, `wing_right`, `fin_left`, `gear_nose`, `canopy`, …
- Materials: `mat_airframe`, `mat_canopy`, `mat_engine`, …
- Avoid spaces and non-ASCII characters in node names.

## Animation clips

Optional. If present, use these names — anything else is ignored:

| Clip | Meaning |
| --- | --- |
| `gear_extend` | Landing gear down (played in reverse to retract) |
| `flaps_extend` | Flaps down |
| `canopy_open` | Canopy open |
| `aileron_left` / `aileron_right` | Roll control surfaces |
| `rudder` | Yaw control surface |

Rigged/skinned models are cloned with `SkeletonUtils.clone`, so each instance gets its own skeleton.

## Hardpoints and attachment points

**Important:** gameplay reference points are *not* read from external models.

The carrier's catapult, landing-zone, arresting, lineup and glide-slope references, and the aircraft
hardpoints/muzzle/engine points, are always defined by the procedural builders
(`src/rendering/models/CarrierModel.ts`, `AircraftModel.ts`). This is deliberate: launch and landing
detection must not silently break because an imported model lacks a marker.

A replacement GLB therefore changes **appearance only**. If you need to move a reference point, edit
`CARRIER_ATTACHMENTS` in `CarrierModel.ts` — and re-run the tests, which assert those points stay
consistent with the collision constants.

For reference, the carrier's named points (carrier-local metres) are:

| Name | Position | Purpose |
| --- | --- | --- |
| `catapultStart` | (-9, 1.5, -95) | Where the player spawns for a cat shot |
| `catapultEnd` | (-9, 1.5, -45) | End of the catapult stroke |
| `landingZoneStart` | (2, 1.5, 50) | Near edge of the arresting zone |
| `landingZoneCenter` | (2, 1.5, 74) | Deck centreline reference |
| `landingZoneEnd` | (2, 1.5, 98) | Far edge of the arresting zone |
| `arrestingPoint` | (2, 1.5, 74) | Where the wire catches |
| `lineupReference` | (2, 1.5, 120) | Approach lineup datum |
| `glideSlopeReference` | (2, 14, 150) | Approach glide-slope datum |
| `carrierRadar` | (11, 27.5, -6) | Rotating air-search array |

## Licensing requirements

Only add assets you have the right to redistribute under this project's terms.

- **Acceptable:** work you authored, CC0 / public domain, or a permissive licence (CC-BY with
  attribution recorded in the README, MIT, etc.).
- **Not acceptable:** "royalty free" marketplace models whose licence forbids redistribution,
  proprietary satellite or map imagery, ripped game assets, or anything with unclear terms.

If you add a third-party asset, record its source, author and licence in the README's attribution
section. Do not add assets that require a runtime call to an external imagery, terrain or map
service — the game is designed to run fully offline.

## Replacing a fallback with a GLB — worked example

1. Export your model as `.glb`, nose toward `+Z` (or set the rotation yourself), in metres.
2. Save it to `public/assets/aircraft/sea-viper/sea-viper.glb`.
3. Run `npm run dev` and open the browser console. You should **not** see the
   `Could not load ".../sea-viper.glb"` warning any more.
4. If the model faces the wrong way or sits at the wrong scale, adjust its `transform` /
   `targetLength` in `src/rendering/ModelRegistry.ts`.
5. Optionally optimize it: `npm run assets:optimize`, then review `public/assets-optimized/`.
6. Enable the performance overlay (Settings → Performance Overlay) and confirm the triangle count
   and frame time are still acceptable.

To go back to the procedural aircraft, delete or rename the file — the fallback resumes immediately.
