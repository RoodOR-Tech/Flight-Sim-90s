import * as THREE from 'three';
import { AssetLoader, LoadedModel } from './AssetLoader';
import { GraphicsSettings } from './GraphicsPresets';
import { makeTransform, ModelTransformConfig } from './ModelTransform';
import { buildAircraftModel } from './models/AircraftModel';
import { buildCarrierModel } from './models/CarrierModel';
import { buildRadarSiteModel } from './models/RadarSiteModel';

/**
 * Declares the optional external model for each entity slot, with the transform needed to bring it
 * into this game's convention (forward = -Z, up = +Y, metres) and the procedural fallback used when
 * the file is absent.
 *
 * The shipped game uses the procedural fallbacks for everything — no GLB files are bundled. Dropping
 * a correctly named GLB into `public/assets/...` makes it take over that slot automatically. See
 * ASSET_GUIDE.md.
 */
export interface ModelSlot {
  id: string;
  url: string;
  /** Target length along the model's longest axis, in metres. */
  targetLength: number;
  transform: ModelTransformConfig;
  description: string;
}

export const MODEL_SLOTS: Record<string, ModelSlot> = {
  seaViper: {
    id: 'aircraft.sea-viper',
    url: 'assets/aircraft/sea-viper/sea-viper.glb',
    targetLength: 9.2,
    // Most exporters author aircraft nose-toward +Z; a 180 deg yaw brings them to nose-toward -Z.
    transform: makeTransform({ rotation: { x: 0, y: 180, z: 0 } }),
    description: "Player's naval interceptor",
  },
  kestrel9: {
    id: 'aircraft.kestrel-9',
    url: 'assets/aircraft/kestrel-9/kestrel-9.glb',
    targetLength: 10,
    transform: makeTransform({ rotation: { x: 0, y: 180, z: 0 } }),
    description: 'Hostile fighter',
  },
  carrier: {
    id: 'ships.cvn-resolute',
    url: 'assets/ships/cvn-resolute/cvn-resolute.glb',
    targetLength: 280,
    transform: makeTransform({}),
    description: 'CVN Resolute',
  },
  radarSite: {
    id: 'structures.radar-site',
    url: 'assets/structures/radar-site/radar-site.glb',
    targetLength: 34,
    transform: makeTransform({}),
    description: 'Coastal radar installation',
  },
};

/**
 * Attempts to load each slot's GLB, falling back to procedural geometry.
 *
 * Note the fallback objects returned here are only the *visual* meshes. The gameplay-critical
 * attachment points (carrier catapult/landing references, aircraft hardpoints) always come from the
 * procedural builders, because an arbitrary GLB cannot be relied upon to define them. An external
 * model therefore replaces the appearance, not the reference frame.
 */
export async function loadOptionalModels(
  assets: AssetLoader,
  settings: GraphicsSettings,
): Promise<Record<string, LoadedModel>> {
  const results: Record<string, LoadedModel> = {};

  const fallbacks: Record<string, () => THREE.Object3D> = {
    seaViper: () => buildAircraftModel('sea-viper', settings).group,
    kestrel9: () => buildAircraftModel('kestrel-9', settings).group,
    carrier: () => buildCarrierModel(settings).group,
    radarSite: () => buildRadarSiteModel(settings).group,
  };

  for (const [key, slot] of Object.entries(MODEL_SLOTS)) {
    assets.setLabel(slot.description);
    results[key] = await assets.loadModel({
      id: slot.id,
      url: slot.url,
      targetLength: slot.targetLength,
      transform: slot.transform,
      fallback: fallbacks[key],
    });
  }

  return results;
}
