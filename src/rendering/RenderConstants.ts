// Centralized rendering tunables.
// Pattern reference: OpenSkyFlight `js/constants/*.js` (MIT source) — a single module of named
// constants rather than magic numbers scattered through subsystem code.

// --- Camera ---
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 12000;
export const CAMERA_BASE_FOV = 62;
/** Extra FOV degrees at maximum speed, giving a sense of acceleration. */
export const CAMERA_SPEED_FOV_GAIN = 8;
/** Extra FOV degrees while the afterburner is lit. */
export const CAMERA_AFTERBURNER_FOV_GAIN = 6;
/** Speed (m/s) at which the speed-based FOV gain saturates. */
export const CAMERA_FOV_REFERENCE_SPEED = 320;
export const CAMERA_FOV_SMOOTHING = 3.5;

/** Chase-camera boom placement (metres, aircraft local frame). */
export const CHASE_BOOM_DISTANCE = 17.5;
export const CHASE_BOOM_HEIGHT = 4.2;
export const CINEMATIC_BOOM_DISTANCE = 44;
export const CINEMATIC_BOOM_HEIGHT = 12;
export const COCKPIT_EYE_OFFSET = { x: 0, y: 0.52, z: -0.55 };

/** Spring stiffness for the chase boom followers. */
export const CHASE_STIFFNESS_POSITION = 90;
export const CINEMATIC_STIFFNESS_POSITION = 22;
/** How much of the aircraft's roll the chase camera copies (0 = horizon stays level). */
export const CHASE_FOLLOW_ROLL = 0.35;
export const CHASE_LOOK_AHEAD = 10;
/** Minimum clearance kept between the camera and terrain/sea surface. */
export const CAMERA_GROUND_CLEARANCE = 3.5;

// --- Lighting / atmosphere ---
export const SUN_ELEVATION_DEG = 31;
export const SUN_AZIMUTH_DEG = 142;
export const SKY_TURBIDITY = 6.5;
export const SKY_RAYLEIGH = 2.6;
export const SKY_MIE_COEFFICIENT = 0.006;
export const SKY_MIE_DIRECTIONAL_G = 0.78;
export const SKY_DOME_SCALE = 10000;

export const FOG_DENSITY = 0.000125;
/** Warm low-sun haze colour, lerped toward the cool colour as the sun climbs. */
export const FOG_WARM_COLOR = 0xbfa98a;
export const FOG_COOL_COLOR = 0x9fc4d8;

export const SUN_LIGHT_BASE_INTENSITY = 0.55;
export const SUN_LIGHT_GAIN = 2.6;
export const HEMI_LIGHT_BASE_INTENSITY = 0.3;
export const HEMI_LIGHT_GAIN = 0.6;
export const HEMI_SKY_COLOR = 0xa8ccdd;
export const HEMI_GROUND_COLOR = 0x2f3a2c;

// --- Renderer ---
export const TONE_MAPPING_EXPOSURE = 0.80;
export const MAX_PIXEL_RATIO = 2;

// --- Adaptive quality (ring-buffer dynamic resolution) ---
// Pattern reference: OpenSkyFlight `js/rendering/AdaptiveQualityManager.js`.
export const FRAME_TIME_RING_SIZE = 40;
export const ADAPTIVE_MIN_SAMPLES = 20;
/** Average frame time (ms) above which resolution scales down (~<50 fps). */
export const ADAPTIVE_HIGH_FRAME_TIME = 20.5;
/** Average frame time (ms) below which resolution scales back up (~>75 fps). */
export const ADAPTIVE_LOW_FRAME_TIME = 13.5;
export const ADAPTIVE_SCALE_DOWN_STEP = 0.08;
/** Deliberately smaller than the down step so quality creeps back rather than oscillating. */
export const ADAPTIVE_SCALE_UP_STEP = 0.03;
export const ADAPTIVE_MIN_PIXEL_RATIO = 0.55;
export const ADAPTIVE_RATIO_EPSILON = 0.015;
/** Minimum seconds between two adaptive changes, damping rapid flapping. */
export const ADAPTIVE_COOLDOWN_SECONDS = 1.25;

// --- Ocean ---
export const OCEAN_SIZE = 24000;
export const OCEAN_WAVE_SCALE = 3.4;
export const OCEAN_WAVE_SPEED = 0.55;
export const OCEAN_COLOR = 0x1a5570;
export const OCEAN_DEEP_COLOR = 0x07293a;

// --- Clouds ---
export const CLOUD_ALTITUDE = 620;
export const CLOUD_FIELD_RADIUS = 5200;
export const CLOUD_DRIFT_SPEED = 1.6;

// --- Terrain ---
export const TERRAIN_MAX_HEIGHT = 108;
