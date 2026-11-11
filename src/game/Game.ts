import * as THREE from 'three';
import { GameState } from './GameState';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { MissionManager } from './MissionManager';
import { WorldBuilder, WORLD_LAYOUT } from '../world/WorldBuilder';
import { PlayerAircraft } from '../entities/PlayerAircraft';
import { EnemyAircraft } from '../entities/EnemyAircraft';
import { GroundTarget } from '../entities/GroundTarget';
import { GroundUnit } from '../entities/GroundUnit';
import { predictBombImpact } from '../entities/Bomb';
import { MISSIONS, MissionId } from './Missions';
import { PlayerInputAdapter } from '../flight/AircraftController';
import { FlightControls } from '../flight/FlightModel';
import { evaluateLanding } from '../flight/LandingEvaluator';
import { CombatSystem } from '../systems/CombatSystem';
import { RadarSystem, RADAR_RANGE } from '../systems/RadarSystem';
import { CollisionSystem } from '../systems/CollisionSystem';
import { EffectsSystem } from '../systems/EffectsSystem';
import { calculateScore } from '../systems/ScoringSystem';
import { HUD, HUDData, HUDRadarContact, LandingGuidance } from '../ui/HUD';
import { TacticalMap, MapContact } from '../ui/TacticalMap';
import { BriefingScreen, BriefingResult } from '../ui/BriefingScreen';
import { ResultsScreen } from '../ui/ResultsScreen';
import { LoadingScreen, TitleScreen, PauseMenu, SettingsPanel } from '../ui/ScreenManager';
import { DIFFICULTY_TABLE, FIXED_TIMESTEP, MAX_FRAME_DT, MPS_TO_KNOTS, METERS_TO_FEET } from './Constants';
import { Targetable } from './Types';
import { CARRIER_LOCAL } from '../entities/Carrier';
import {
  applyRendererQuality,
  createCamera,
  createRenderer,
  createScene,
} from '../rendering/RendererSetup';
import { GraphicsSettings, resolvePreset, detectAutoPreset } from '../rendering/GraphicsPresets';
import { CameraMode, CameraRig, CameraRigInput } from '../rendering/CameraRig';
import { PerformanceMonitor } from '../rendering/PerformanceMonitor';
import { AdaptiveQuality } from '../rendering/AdaptiveQuality';
import { PostProcessing } from '../rendering/PostProcessing';
import { CockpitView } from '../rendering/CockpitView';
import { AssetLoader } from '../rendering/AssetLoader';
import { MODEL_SLOTS, loadOptionalModels } from '../rendering/ModelRegistry';
import { inspectModel, logModelReport } from '../rendering/ModelDiagnostics';
import { MAX_PIXEL_RATIO } from '../rendering/RenderConstants';

type LaunchPhase = 'none' | 'onDeck' | 'catapult' | 'airborne';

const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit', 'cinematic'];
const CATAPULT_DURATION = 1.7;
const CATAPULT_LAUNCH_SPEED = 78;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private state = new GameState();
  private input: InputManager;
  private audio = new AudioManager();
  private world!: WorldBuilder;
  private mission = new MissionManager();
  private combat = new CombatSystem();
  private radar = new RadarSystem();
  private effects: EffectsSystem;
  private playerInputAdapter: PlayerInputAdapter;

  private player!: PlayerAircraft;
  private enemies: EnemyAircraft[] = [];
  private groundTarget!: GroundTarget;
  /** Mission 2 vehicles: tanks (the objective) and flak carriers (optional, hostile). */
  private groundUnits: GroundUnit[] = [];
  private missionId: MissionId = 'broken_beacon';

  private hud: HUD;
  private tacticalMap: TacticalMap;
  private briefing: BriefingScreen;
  private results: ResultsScreen;
  private loading: LoadingScreen;
  private title: TitleScreen;
  private pauseMenu: PauseMenu;
  private settingsPanel: SettingsPanel;
  private subtitleEl: HTMLElement;
  private fpsEl: HTMLElement;

  private graphics: GraphicsSettings;
  private cameraRig = new CameraRig();
  private perf: PerformanceMonitor;
  private adaptive: AdaptiveQuality;
  private post: PostProcessing | null = null;
  private cockpit!: CockpitView;
  private assets: AssetLoader;

  private cameraMode: CameraMode = 'chase';
  private lookYawDeg = 0;
  private lookPitchDeg = 0;
  private launchPhase: LaunchPhase = 'none';
  private catapultTimer = 0;
  private lastMessageId = -1;
  private accumulator = 0;
  private lastTime = performance.now();
  private frameCount = 0;
  private fpsTimer = 0;
  private landingResult: 'pending' | 'success' | 'crash' = 'pending';

  // Reused scratch objects — the render loop must not allocate per frame.
  private tmpShake = new THREE.Vector3();
  private tmpForward = new THREE.Vector3();
  private tmpVec = new THREE.Vector3();
  private tmpImpact = new THREE.Vector3();
  private armorCentroid = new THREE.Vector3();
  private rigInput: CameraRigInput;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.graphics = resolvePreset('auto');

    this.renderer = createRenderer(canvas, this.graphics);
    this.scene = createScene();
    this.camera = createCamera();
    // The camera is added to the scene so the cockpit (parented to it) is rendered.
    this.scene.add(this.camera);

    this.assets = new AssetLoader(this.renderer);
    this.world = new WorldBuilder(this.scene, this.graphics);
    this.effects = new EffectsSystem(this.scene, this.graphics);
    this.cockpit = new CockpitView(this.camera);

    this.adaptive = new AdaptiveQuality(this.renderer.getPixelRatio(), {
      setPixelRatio: (r) => {
        this.renderer.setPixelRatio(r);
        this.post?.setSize(window.innerWidth, window.innerHeight);
      },
    });

    this.input = new InputManager(canvas);
    this.playerInputAdapter = new PlayerInputAdapter(this.input);

    this.rigInput = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      forward: new THREE.Vector3(),
      speed: 0,
      afterburner: false,
      rollDeg: 0,
      groundHeight: 0,
      shake: this.tmpShake,
      lookYawDeg: 0,
      lookPitchDeg: 0,
    };

    this.hud = new HUD(uiRoot);
    this.perf = new PerformanceMonitor(uiRoot);
    this.tacticalMap = new TacticalMap(uiRoot);
    this.briefing = new BriefingScreen(uiRoot);
    this.results = new ResultsScreen(uiRoot);
    this.loading = new LoadingScreen(uiRoot);
    this.title = new TitleScreen(uiRoot);
    this.pauseMenu = new PauseMenu(uiRoot, {
      onResume: () => this.togglePause(false),
      onRestart: () => this.restartMission(),
      onSettings: () => this.settingsPanel.show(),
      onQuitToTitle: () => this.goToTitle(),
    });
    this.settingsPanel = new SettingsPanel(uiRoot, this.state.settings, (s) => this.applySettings(s));

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'subtitle-box';
    this.subtitleEl.style.display = 'none';
    uiRoot.appendChild(this.subtitleEl);

    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps-counter';
    this.fpsEl.style.display = 'none';
    uiRoot.appendChild(this.fpsEl);

    this.wireScreens();
    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);

    this.hud.setVisible(false);
    this.exposeTestState();
    void this.initializePostProcessing();
    void this.showLoading();
  }

  /**
   * Publishes a small read-only snapshot of scene/mission state on `window.__obbTestState`.
   *
   * This exists so the browser smoke test can assert that the world really loaded and the aircraft
   * really flies, rather than only checking that DOM elements exist. It is a getter over live state
   * with no setters, so it cannot be used to drive the game.
   */
  private exposeTestState() {
    if (import.meta.env.DEV) {
      // Development-only affordance so an automated run can exercise the recovery and landing
      // phases without first having to win the dogfight. Stripped from production builds.
      (window as unknown as Record<string, unknown>).__obbDevSkipToRecovery = () => {
        for (const enemy of this.enemies) {
          enemy.applyDamage(9999);
          enemy.setVisible(false);
        }
        for (const unit of this.groundUnits) unit.applyDamage(9999);
        this.groundTarget.active = true;
        this.groundTarget.applyDamage(9999);
        this.mission.devJumpToRecovery();
        return this.mission.stage;
      };
      // Development-only: place the aircraft for an automated attack-run check (position, heading
      // and dive angle in degrees, speed in m/s). Stripped from production builds.
      (window as unknown as Record<string, unknown>).__obbDevPlace = (
        x: number, y: number, z: number, headingDeg: number, pitchDeg: number, speed: number,
      ) => {
        const fm = this.player.controller.flightModel;
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), -THREE.MathUtils.degToRad(headingDeg), 0, 'YXZ');
        fm.quaternion.setFromEuler(euler);
        fm.position.set(x, y, z);
        fm.velocity.copy(fm.getForward()).multiplyScalar(speed);
        this.cameraRig.snap();
      };
    }

    (window as unknown as Record<string, unknown>).__obbTestState = () => {
      const fm = this.player?.controller.flightModel;
      return {
        screen: this.state.screen,
        paused: this.state.paused,
        missionId: this.missionId,
        missionStage: this.mission.stage,
        launchPhase: this.launchPhase,
        cameraMode: this.cameraMode,
        playerLoaded: Boolean(this.player && this.player.root.parent === this.scene),
        carrierLoaded: Boolean(this.world?.carrier?.group.parent === this.scene),
        radarSiteLoaded: Boolean(this.groundTarget && this.groundTarget.root.parent === this.scene),
        enemyCount: this.enemies.length,
        enemiesAlive: this.enemies.filter((e) => e.isAlive()).length,
        altitude: fm ? fm.position.y : 0,
        speed: fm ? fm.getSpeed() : 0,
        heading: fm ? fm.getHeadingDegrees() : 0,
        health: this.player?.controller.health ?? 0,
        maxHealth: this.player?.controller.maxHealth ?? 0,
        missiles: this.player?.missileCount ?? 0,
        cannonAmmo: this.player?.cannonAmmo ?? 0,
        bombs: this.player?.bombCount ?? 0,
        bombsInFlight: this.combat.bombs.length,
        groundUnits: this.groundUnits.map((u) => ({
          id: u.id,
          kind: u.unitKind,
          alive: u.isAlive(),
          position: u.getPosition().toArray(),
        })),
        radarDestroyed: this.groundTarget?.destroyed ?? false,
        landingResult: this.landingResult,
        graphicsQuality: this.effectiveGraphicsLabel(),
        pixelRatio: this.renderer.getPixelRatio(),
        postProcessing: this.post?.isEnabled() ?? false,
        // Positions, so an automated regression run can navigate the mission end to end.
        position: fm ? fm.position.toArray() : [0, 0, 0],
        pitchDeg: fm ? fm.getPitchDegrees() : 0,
        rollDeg: fm ? fm.getRollDegrees() : 0,
        stalling: fm?.stalling ?? false,
        gearDown: fm?.gearDown ?? false,
        flapsDown: fm?.flapsDown ?? false,
        locked: this.player?.locked ?? false,
        lockProgress: this.player?.lockProgress ?? 0,
        currentTargetId: this.player?.currentTargetId ?? null,
        waypoint: this.mission.currentWaypoint()?.toArray() ?? null,
        carrierPosition: this.world?.carrier?.getPosition().toArray() ?? [0, 0, 0],
        carrierHeading: this.world?.carrier?.headingDeg ?? 0,
        radarPosition: this.groundTarget?.getPosition().toArray() ?? [0, 0, 0],
        enemies: this.enemies.map((e) => ({
          id: e.id,
          alive: e.isAlive(),
          position: e.getPosition().toArray(),
        })),
      };
    };
  }

  private async initializePostProcessing() {
    if (!this.graphics.postProcessing) {
      this.post?.dispose();
      this.post = null;
      return;
    }
    this.post = await PostProcessing.create(this.renderer, this.scene, this.camera, this.graphics);
  }


  private wireScreens() {
    this.title.onStart(() => this.goToBriefing());
    this.briefing.onSettings(() => this.settingsPanel.show());
    this.briefing.onStartMission((result) => this.startMission(result));
    this.results.onRestart(() => this.restartMission());
    this.results.onReturnToBriefing(() => this.goToBriefing());
    this.settingsPanel.onClose(() => {
      this.settingsPanel.hide();
      if (this.state.screen === 'paused') this.pauseMenu.show();
    });
  }

  /**
   * Reports real initialization stages on the loading screen.
   *
   * The world, terrain and carrier are already built by the constructor (they are procedural); this
   * pass probes for the *optional* external models, which is genuine async work that can fail. The
   * mission is not offered until it completes, but a missing optional GLB never blocks it.
   */
  private async showLoading() {
    this.state.screen = 'loading';
    this.startLoop();

    const totalSteps = 6;
    let completed = 0;
    const advance = (label: string) => {
      completed += 1;
      this.loading.setStage(label);
      this.loading.setProgress(completed / totalSteps);
      // Yield to the browser so the loading bar actually paints between stages.
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };

    try {
      await advance('Core systems');
      await advance('Environment and atmosphere');
      await advance('Terrain and islands');

      // Probe optional external models. Each resolves to either a GLB or a procedural fallback.
      this.assets.setTotalSteps(Object.keys(MODEL_SLOTS).length);
      this.loading.setStage('Checking for optional models');
      const loaded = await loadOptionalModels(this.assets, this.graphics);

      if (import.meta.env.DEV) {
        for (const [key, result] of Object.entries(loaded)) {
          if (!result.usedFallback) {
            logModelReport(inspectModel(result.object, `${key} (${result.source})`));
          }
        }
        const external = Object.entries(loaded).filter(([, r]) => !r.usedFallback);
        console.info(
          external.length === 0
            ? '[Game] No external models supplied; using procedural geometry for everything (expected).'
            : `[Game] Using external models for: ${external.map(([k]) => k).join(', ')}`,
        );
      }
      // The probe results are diagnostic only — the live entities are built from the procedural
      // models so their gameplay attachment points are guaranteed present. See ASSET_GUIDE.md.
      for (const result of Object.values(loaded)) {
        result.object.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry?.dispose();
          }
        });
      }

      await advance('Combat systems');
      await advance('Audio');
      await advance('Mission data');
    } catch (err) {
      // Initialization must never dead-end on a blank canvas.
      console.error('[Game] Initialization hit a problem; continuing with fallbacks.', err);
    }

    this.loading.hide();
    this.goToTitle();
  }

  private goToTitle() {
    this.stopSpeech();
    this.state.screen = 'title';
    this.hideAllScreens();
    this.title.show();
  }

  private goToBriefing() {
    this.audio.resume();
    this.state.screen = 'briefing';
    this.hideAllScreens();
    this.briefing.setDifficulty(this.state.settings.difficulty);
    this.briefing.show();
  }

  private hideAllScreens() {
    this.title.hide();
    this.briefing.hide();
    this.results.hide();
    this.pauseMenu.hide();
    this.settingsPanel.hide();
    this.tacticalMap.hide();
    this.hud.setVisible(false);
  }

  private applySettings(s: typeof this.state.settings) {
    this.audio.setMuted(s.muted);
    if (s.muted) this.stopSpeech();
    this.state.saveSettings();
    this.input.sensitivity = s.mouseSensitivity;
    this.perf.setVisible(s.showPerfOverlay);
    this.cameraRig.dampingScale = s.cameraDamping;
    this.applyGraphicsQuality();
  }

  /** Re-resolves the graphics preset and pushes it through every subsystem that depends on it. */
  private applyGraphicsQuality() {
    const next = resolvePreset(this.state.settings.graphicsQuality);
    const postProcessingChanged = next.postProcessing !== this.graphics.postProcessing
      || next.bloom !== this.graphics.bloom
      || next.antialiasPass !== this.graphics.antialiasPass
      || next.vignette !== this.graphics.vignette;

    this.graphics = next;
    applyRendererQuality(this.renderer, next);
    this.adaptive.setBasePixelRatio(
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, next.maxPixelRatio),
    );
    this.adaptive.reset();
    this.world.applyQuality(next);
    this.effects.applyQuality(next);

    if (postProcessingChanged) {
      this.post?.dispose();
      this.post = null;
      void this.initializePostProcessing();
    }
    // Note: water reflectivity and terrain mesh density are baked at construction; they take
    // effect on the next mission start rather than mid-flight, to avoid a visible rebuild hitch.
  }

  private effectiveGraphicsLabel(): string {
    const q = this.state.settings.graphicsQuality;
    return q === 'auto' ? `auto(${detectAutoPreset()})` : q;
  }

  // ------------------------------------------------------------------
  // Mission lifecycle
  // ------------------------------------------------------------------

  private startMission(result: BriefingResult) {
    this.state.settings.difficulty = result.difficulty;
    this.state.skipCarrierLaunch = result.skipLaunch;
    this.missionId = result.missionId;
    this.applySettings(this.state.settings);
    this.audio.resume();
    this.audio.startEngine();
    this.setupEntities();
    this.player.damageMultiplier = DIFFICULTY_TABLE[result.difficulty].playerDamageMultiplier;
    this.stopSpeech();
    this.mission.reset(this.missionId);
    this.combat.reset(this.scene);
    this.effects.reset();
    this.world.resetForMission();
    this.cameraRig.reset();
    this.adaptive.reset();
    this.lookYawDeg = 0;
    this.lookPitchDeg = 0;
    this.landingResult = 'pending';
    this.lastMessageId = -1;
    this.subtitleEl.style.display = 'none';

    if (result.skipLaunch) {
      this.launchPhase = 'airborne';
      const carrier = this.world.carrier;
      const startPos = carrier.getPosition().clone().add(new THREE.Vector3(400, 420, -600));
      this.player.controller.flightModel.position.copy(startPos);
      this.player.controller.flightModel.velocity.copy(carrier.getForward().multiplyScalar(140));
      this.player.controller.flightModel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), carrier.getForward());
      this.player.controller.flightModel.throttle = 0.7;
      this.player.controller.flightModel.gearDown = false;
      this.mission.beginFlight();
    } else {
      this.launchPhase = 'onDeck';
      this.placeOnCatapult();
      this.mission.radioMessage('Resolute Control', 'Viper One, you are cleared for cat shot. Advance throttle to launch.');
    }

    this.hideAllScreens();
    this.hud.setVisible(true);
    this.state.screen = 'playing';
    this.state.paused = false;
  }

  private restartMission() {
    this.startMission({
      difficulty: this.state.settings.difficulty,
      skipLaunch: this.state.skipCarrierLaunch,
      missionId: this.missionId,
    });
  }

  /**
   * Prepares entities for a mission. The player and ground target are built once and then reset
   * on subsequent runs, so restarting does not churn geometry or leak scene objects.
   */
  private setupEntities() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];

    for (const u of this.groundUnits) u.dispose(this.scene);
    this.groundUnits = [];

    if (!this.player) this.player = new PlayerAircraft(this.scene, this.graphics);
    this.player.resetForMission(MISSIONS[this.missionId].loadout);

    if (!this.groundTarget) {
      // Seat the installation on the terrain the generator actually produced, so it never floats
      // above or sinks into the radar plateau.
      const radarPos = WORLD_LAYOUT.radarSitePosition.clone();
      radarPos.y = this.world.terrain.radarPadHeight;
      this.groundTarget = new GroundTarget(this.scene, radarPos, this.graphics);
    } else {
      this.groundTarget.resetForMission();
    }

    if (this.missionId === 'iron_anvil') this.spawnArmorColumn();
  }

  /** Six tanks in line astern along the plateau route, plus two stationary flak carriers. */
  private spawnArmorColumn() {
    const diff = DIFFICULTY_TABLE[this.state.settings.difficulty];
    const start = WORLD_LAYOUT.armorRouteStart;
    const end = WORLD_LAYOUT.armorRouteEnd;
    const dir = end.clone().sub(start).setY(0).normalize();
    const tanks = 6;
    const spacing = 44;
    for (let i = 0; i < tanks; i++) {
      // i = 0 is the lead tank: it starts furthest along and drives all the way to the end.
      this.groundUnits.push(
        new GroundUnit(
          this.scene,
          {
            kind: 'tank',
            id: `tank-${i + 1}`,
            start: start.clone().addScaledVector(dir, (tanks - 1 - i) * spacing),
            destination: end,
            haltShort: i * spacing,
          },
          this.terrainHeightAt,
          diff,
          this.graphics,
        ),
      );
    }
    WORLD_LAYOUT.flakPositions.forEach((pos, i) => {
      this.groundUnits.push(
        new GroundUnit(this.scene, { kind: 'flak', id: `flak-${i + 1}`, start: pos }, this.terrainHeightAt, diff, this.graphics),
      );
    });
  }

  private armorRemaining(): number {
    let n = 0;
    for (const u of this.groundUnits) if (u.unitKind === 'tank' && u.isAlive()) n += 1;
    return n;
  }

  /** Everything the player can currently lock, shoot or bomb. */
  private liveTargets(): Targetable[] {
    const targets: Targetable[] = this.enemies.filter((e) => e.isAlive());
    if (this.groundTarget.active && this.groundTarget.isAlive()) targets.push(this.groundTarget);
    for (const u of this.groundUnits) if (u.isAlive()) targets.push(u);
    return targets;
  }

  private updateGroundUnits(dt: number) {
    const fm = this.player.controller.flightModel;
    for (const unit of this.groundUnits) {
      unit.update(dt, fm.position, fm.velocity, this.player.isAlive());
      if (unit.fireRequested) {
        this.combat.fireCannon(this.scene, unit.fireOrigin, unit.fireDirection, 'enemy');
        this.effects.muzzleFlash(unit.fireOrigin);
      }
    }
  }

  private placeOnCatapult() {
    const carrier = this.world.carrier;
    const { start } = carrier.getCatapultWorld();
    const fm = this.player.controller.flightModel;
    fm.position.copy(start);
    fm.velocity.set(0, 0, 0);
    fm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), carrier.getForward());
    fm.throttle = 0;
    fm.gearDown = true;
    fm.flapsDown = false;
    this.catapultTimer = 0;
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------

  private startLoop() {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const frameTimeMs = now - this.lastTime;
      let rawDt = frameTimeMs / 1000;
      this.lastTime = now;
      // Clamp so a tab switch or a GC pause cannot teleport the simulation.
      rawDt = Math.min(rawDt, MAX_FRAME_DT);

      this.frameCount += 1;
      this.fpsTimer += rawDt;
      if (this.fpsTimer >= 0.5) {
        this.fpsEl.textContent = `${Math.round(this.frameCount / this.fpsTimer)} FPS`;
        this.frameCount = 0;
        this.fpsTimer = 0;
      }
      this.perf.sample(rawDt, frameTimeMs);

      // Dynamic resolution only runs during gameplay, where the cost actually varies.
      if (this.state.screen === 'playing' && !this.state.paused) {
        this.adaptive.update(frameTimeMs, rawDt);
      }

      if (this.state.screen === 'playing' || this.state.screen === 'paused') {
        if (this.input.consumeJustPressed('pause') || this.input.consumeJustPressed('menu')) {
          this.togglePause();
        }
      }

      if (this.state.screen === 'playing') {
        this.accumulator += rawDt;
        let steps = 0;
        this.perf.beginSubsystem('sim');
        while (this.accumulator >= FIXED_TIMESTEP && steps < 6) {
          this.fixedUpdate(FIXED_TIMESTEP);
          this.accumulator -= FIXED_TIMESTEP;
          steps += 1;
        }
        this.perf.endSubsystem('sim');
        // One-shot key edges are consumed inside fixedUpdate. A rendered frame that ran no sim step
        // (routine on displays faster than the 60 Hz sim) must keep them for the next step,
        // otherwise the press is silently lost.
        if (steps > 0) this.input.endFrame();
      } else {
        this.input.endFrame();
      }
      this.render(rawDt);
    };
    requestAnimationFrame(loop);
  }

  private fixedUpdate(dt: number) {
    if (this.input.consumeJustPressed('toggleMap')) {
      this.toggleMap();
    }
    if (this.state.paused || this.tacticalMap.isVisible()) return;

    this.world.update(dt, this.camera.position, this.player.getPosition());
    this.groundTarget.update(dt, this.mission.elapsedTime);

    if (this.input.consumeJustPressed('cycleCamera')) {
      this.cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length];
      // Immediate, stable transition: snap the rig instead of easing between two very
      // different boom positions.
      this.cameraRig.snap();
      this.cockpit.setVisible(this.cameraMode === 'cockpit');
    }

    // Landing gear and flaps. Both are on a short cooldown inside the controller so a held key
    // cannot chatter the state.
    if (this.input.consumeJustPressed('toggleGear')) {
      const before = this.player.controller.flightModel.gearDown;
      const after = this.player.controller.toggleGear();
      if (after !== before) {
        this.audio.menuConfirm();
        this.mission.radioMessage('Viper One', after ? 'Gear down and locked.' : 'Gear up.');
      }
    }
    if (this.input.consumeJustPressed('toggleFlaps')) {
      const before = this.player.controller.flightModel.flapsDown;
      const after = this.player.controller.toggleFlaps();
      if (after !== before) this.audio.menuConfirm();
    }

    this.updateLaunchSequence();

    const controls: FlightControls =
      this.launchPhase === 'onDeck' || this.launchPhase === 'catapult'
        ? { pitch: 0, roll: 0, yaw: 0, throttleInput: 0, afterburner: false }
        : this.playerInputAdapter.read();

    if (this.launchPhase === 'onDeck') {
      // Player may spool the throttle while pinned to the catapult.
      const throttleInput = this.input.isHeld('throttleUp') ? 1 : this.input.isHeld('throttleDown') ? -1 : 0;
      this.player.controller.flightModel.throttle = THREE.MathUtils.clamp(
        this.player.controller.flightModel.throttle + throttleInput * 0.5 * dt,
        0,
        1,
      );
      const carrier = this.world.carrier;
      const { start } = carrier.getCatapultWorld();
      this.player.controller.flightModel.position.copy(start);
      this.player.controller.flightModel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), carrier.getForward());
      this.player.controller.syncMesh();
    } else if (this.launchPhase === 'catapult') {
      this.catapultTimer += dt;
      const t = Math.min(1, this.catapultTimer / CATAPULT_DURATION);
      const carrier = this.world.carrier;
      const fm = this.player.controller.flightModel;
      const speed = THREE.MathUtils.lerp(4, CATAPULT_LAUNCH_SPEED, t);
      fm.velocity.copy(carrier.getForward().multiplyScalar(speed));
      fm.position.addScaledVector(fm.velocity, dt);
      fm.throttle = 1;
      this.player.controller.syncMesh();
      if (t >= 1) {
        this.launchPhase = 'airborne';
        this.mission.beginFlight();
      }
    } else {
      this.player.controller.step(dt, controls);
    }
    this.player.update(dt);

    if (this.launchPhase === 'airborne') {
      this.handleWeaponsInput(dt);
      this.updateEnemies(dt);
      this.updateGroundUnits(dt);
      this.updateCombat(dt);
      this.updateCrashChecks(dt);
      this.updateLandingLogic(dt);
    }

    this.emitDamageEffects(dt);
    this.effects.update(dt);
    this.audio.updateEngine(this.player.controller.flightModel.throttle, this.player.controller.flightModel.afterburnerActive);

    this.mission.update(dt, {
      playerAlive: this.player.controller.alive,
      playerPosition: this.player.getPosition(),
      enemiesRemaining: this.enemies.filter((e) => e.isAlive()).length,
      radarDestroyed: this.groundTarget.destroyed,
      landedSuccessfully: this.landingResult === 'success',
      civilianStrikes: this.player.civilianStrikes,
      armorRemaining: this.armorRemaining(),
    });

    if (this.mission.stage === 'strike_radar' && !this.groundTarget.active) {
      this.groundTarget.active = true;
    }
    if (this.mission.stage === 'intercept' && this.enemies.length === 0) {
      this.spawnEnemies();
    }

    if (this.mission.stage === 'rtb') {
      const carrier = this.world.carrier;
      const dist = this.player.getPosition().distanceTo(carrier.getPosition());
      if (dist < 1600) this.mission.enterLandingStage();
    }

    if (this.mission.activeMessage && this.mission.activeMessage.id !== this.lastMessageId) {
      this.lastMessageId = this.mission.activeMessage.id;
      this.showSubtitle(this.mission.activeMessage.speaker, this.mission.activeMessage.text);
    }
    if (!this.mission.activeMessage) {
      this.subtitleEl.style.display = 'none';
    }

    if (this.mission.stage === 'failed' && this.state.screen === 'playing') {
      this.endMission(false, this.mission.failReason);
    }
    if (this.mission.stage === 'success' && this.state.screen === 'playing') {
      this.endMission(true);
    }
  }

  private spawnEnemies() {
    if (this.enemies.length > 0) return;
    const diff = DIFFICULTY_TABLE[this.state.settings.difficulty];
    this.enemies.push(new EnemyAircraft(this.scene, WORLD_LAYOUT.enemySpawnA.clone(), diff, this.graphics));
    this.enemies.push(new EnemyAircraft(this.scene, WORLD_LAYOUT.enemySpawnB.clone(), diff, this.graphics));
  }

  /**
   * Emits trailing smoke/sparks from damaged aircraft and the destroyed radar site.
   * Rate-limited inside each entity so the particle budget stays bounded.
   */
  private emitDamageEffects(dt: number) {
    void dt;
    const playerHealth = this.player.controller.healthFraction();
    if (this.player.isAlive() && playerHealth < 0.55) {
      const severity = 1 - playerHealth;
      // Emit from one engine point per frame, alternating, to halve the particle rate.
      const points = this.player.getDamageWorldPositions();
      const point = points[this.frameCount % points.length];
      if (point && Math.random() < 0.55) {
        this.effects.damageSmoke(point, severity);
      }
    }

    for (const enemy of this.enemies) {
      if (!enemy.isAlive()) continue;
      if (enemy.consumeSmokeTick()) {
        const points = enemy.getDamageWorldPositions();
        const point = points[0];
        if (point) this.effects.damageSmoke(point, 1 - enemy.controller.healthFraction());
      }
    }

    for (const unit of this.groundUnits) {
      if (unit.consumeSmokeTick()) this.effects.damageSmoke(unit.getSmokeWorldPosition(this.tmpVec), 0.8);
    }

    if (this.groundTarget.consumeSmokeTick()) {
      const points = this.groundTarget.getDamageWorldPositions();
      const point = points[this.frameCount % points.length];
      if (point) this.effects.damageSmoke(point, 0.85);
    }
  }

  private updateLaunchSequence() {
    if (this.launchPhase !== 'onDeck') return;
    if (this.player.controller.flightModel.throttle >= 0.97) {
      this.launchPhase = 'catapult';
      this.catapultTimer = 0;
    }
  }

  private handleWeaponsInput(_dt: number) {
    const targets = this.liveTargets();

    if (this.input.consumeJustPressed('cycleTarget')) {
      this.radar.cycleTarget(this.player, targets);
    }
    const lockHeld = this.input.isHeld('radarLock');
    const { justAcquired } = this.radar.update(_dt, this.player, targets, lockHeld);
    if (justAcquired) this.audio.lockAcquiredTone();
    else if (lockHeld && !this.player.locked && this.player.lockProgress > 0) {
      // subtle periodic tone while locking handled via HUD visuals only to avoid audio spam
    }

    if (this.input.isHeld('fireCannon') && this.player.canFireCannon()) {
      this.player.consumeCannonShot();
      const origin = this.player.getMuzzleWorldPosition();
      const dir = this.player.controller.flightModel.getForward();
      this.combat.fireCannon(this.scene, origin, dir, 'player');
      this.effects.muzzleFlash(origin);
      this.audio.cannonFire();
    }

    if (this.input.consumeJustPressed('dropBomb') && this.player.canDropBomb()) {
      this.player.consumeBomb();
      const fm = this.player.controller.flightModel;
      // Released from just under the fuselage with the aircraft's own velocity.
      const origin = this.tmpVec.copy(fm.position).addScaledVector(fm.getUp(this.tmpForward), -1.4);
      this.combat.dropBomb(this.scene, origin, fm.velocity);
      this.audio.menuConfirm();
    }

    if (this.input.consumeJustPressed('fireMissile') && this.player.canFireMissile() && this.player.locked) {
      const target = targets.find((t) => t.id === this.player.currentTargetId) ?? null;
      if (target) {
        this.player.consumeMissile();
        const origin = this.player.getMuzzleWorldPosition();
        const dir = this.player.controller.flightModel.getForward();
        this.combat.fireMissile(this.scene, origin, dir, target, 'player', this.effects);
        this.audio.missileLaunch();
        const enemyTarget = this.enemies.find((e) => e.id === target.id);
        enemyTarget?.notifyMissileThreat();
      }
    }
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.enemies) {
      if (!enemy.isAlive()) continue;
      const otherEnemy = this.enemies.find((e) => e !== enemy && e.isAlive());
      enemy.update(dt, this.player.getPosition(), this.player.isAlive(), otherEnemy ? otherEnemy.getPosition() : null);
      if (enemy.cannonFireRequested) {
        const origin = enemy.controller.flightModel.position.clone().addScaledVector(enemy.controller.flightModel.getForward(), 3.5);
        this.combat.fireCannon(this.scene, origin, enemy.controller.flightModel.getForward(), 'enemy');
      }
      if (enemy.missileFireRequested) {
        const origin = enemy.controller.flightModel.position.clone();
        this.combat.fireMissile(this.scene, origin, enemy.controller.flightModel.getForward(), this.player, 'enemy', this.effects);
        this.audio.missileLaunch();
      }
    }
  }

  private updateCombat(dt: number) {
    const hostileTargets = this.liveTargets();
    const events = this.combat.update(dt, {
      scene: this.scene,
      player: this.player,
      hostileTargets,
      civilianStructures: this.world.terrain.civilianStructures,
      terrainHeightAt: this.terrainHeightAt,
      effects: this.effects,
      audio: this.audio,
    });
    for (const ev of events) {
      if (ev.type === 'civilian-hit') this.player.civilianStrikes += 1;
      if (ev.type === 'target-destroyed') {
        if (ev.targetId === this.groundTarget.id) {
          // A bigger, longer secondary blast for the installation.
          const pos = this.groundTarget.getPosition();
          this.effects.explosion(pos, 2.6);
          this.effects.explosion(this.tmpVec.copy(pos).add(new THREE.Vector3(4, -2, 3)), 1.7);
        } else {
          const enemy = this.enemies.find((e) => e.id === ev.targetId);
          if (enemy) {
            this.effects.explosion(enemy.getPosition(), 1.7);
            enemy.setVisible(false);
          }
          const unit = this.groundUnits.find((u) => u.id === ev.targetId);
          if (unit) {
            this.effects.explosion(unit.getPosition(), 1.9);
            this.audio.explosion();
            const left = this.armorRemaining();
            if (unit.unitKind === 'tank' && left > 0) {
              this.mission.radioMessage('Airborne Control', `Good kill. ${left} tank${left === 1 ? '' : 's'} remaining.`);
            } else if (unit.unitKind === 'flak') {
              this.mission.radioMessage('Airborne Control', 'Flak vehicle destroyed.');
            }
          }
        }
      }
    }
  }

  private terrainHeightAt = (x: number, z: number) => this.world.terrain.getHeightAt(x, z);

  private updateCrashChecks(_dt: number) {
    if (!this.player.isAlive()) return;
    const pos = this.player.getPosition();
    const carrier = this.world.carrier;
    const contact = CollisionSystem.carrierContact(pos, carrier);

    if (contact === 'hull') {
      this.crashPlayer('hull');
      return;
    }
    if (contact === 'none') {
      if (CollisionSystem.oceanCrash(pos)) {
        this.crashPlayer('water');
        return;
      }
      if (CollisionSystem.terrainCrash(pos, this.world.terrain, this.player.getCollisionRadius())) {
        this.crashPlayer('ground');
        return;
      }
    }
    for (const enemy of this.enemies) {
      if (!enemy.isAlive()) continue;
      if (CollisionSystem.aircraftCollision(pos, this.player.getCollisionRadius(), enemy.getPosition(), enemy.getCollisionRadius())) {
        this.effects.explosion(enemy.getPosition(), 1.6);
        enemy.applyDamage(999);
        enemy.setVisible(false);
        this.crashPlayer('midair');
        return;
      }
    }
  }

  private crashPlayer(cause: 'water' | 'ground' | 'hull' | 'midair' = 'ground') {
    if (!this.player.isAlive()) return;
    const pos = this.player.getPosition();
    this.effects.explosion(pos, 1.9);
    if (cause === 'water') {
      this.effects.waterSplash(pos, 2.2);
    } else if (cause === 'ground') {
      this.effects.groundImpact(pos);
    }
    this.audio.explosion();
    this.effects.addShake(1.6);
    this.player.controller.applyDamage(999);
    this.player.setVisible(false);
  }

  private updateLandingLogic(_dt: number) {
    if (this.mission.stage !== 'landing') return;
    const pos = this.player.getPosition();
    const carrier = this.world.carrier;
    const contact = CollisionSystem.carrierContact(pos, carrier);
    if (contact === 'hull') {
      this.crashPlayer();
      return;
    }
    if (contact !== 'deck') return;

    const local = CollisionSystem.localDeckPosition(pos, carrier);
    const inArrestingZone = local.z > CARRIER_LOCAL.arrestingZoneStart.z && local.z < CARRIER_LOCAL.arrestingZoneEnd.z;
    if (!inArrestingZone) return;

    const fm = this.player.controller.flightModel;
    const headingDiff = this.angleDiffDeg(fm.getHeadingDegrees(), carrier.headingDeg);
    const evaluation = evaluateLanding({
      gearDown: fm.gearDown,
      speed: fm.getSpeed(),
      descentRate: -fm.velocity.y,
      lateralOffset: local.x - CARRIER_LOCAL.deckCenterline,
      headingDiffDeg: headingDiff,
      inArrestingZone,
    });

    if (evaluation.success) {
      this.landingResult = 'success';
      fm.velocity.set(0, 0, 0);
      fm.position.y = carrier.getPosition().y + CARRIER_LOCAL.deckY + 0.7;
      this.audio.touchdown();
      this.audio.arrestingWire();
      this.effects.addShake(0.5);
      this.mission.completeSuccess();
    } else {
      this.crashPlayer();
    }
  }

  private angleDiffDeg(a: number, b: number): number {
    let diff = (a - b) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }

  // ------------------------------------------------------------------
  // Rendering & camera
  // ------------------------------------------------------------------

  private render(rawDt: number) {
    const playing = this.state.screen === 'playing' && !this.state.paused && !this.tacticalMap.isVisible();

    if (playing) {
      this.perf.beginSubsystem('camera');
      this.updateCamera(rawDt);
      this.perf.endSubsystem('camera');

      this.perf.beginSubsystem('hud');
      this.hud.render(this.computeHUDData(), rawDt);
      this.perf.endSubsystem('hud');
    } else {
      // Drain queued mouse motion so the view does not lurch when gameplay resumes.
      this.input.consumeMouseDelta();
    }

    if (this.tacticalMap.isVisible()) {
      this.tacticalMap.render(this.computeMapContacts(), this.mission.objectiveText());
    }

    this.fpsEl.style.display = this.state.settings.showFps ? 'block' : 'none';

    this.perf.beginSubsystem('draw');
    // Postprocessing composites when available; otherwise fall straight through to the renderer.
    if (!this.post?.render(rawDt)) {
      this.renderer.render(this.scene, this.camera);
    }
    this.perf.endSubsystem('draw');

    this.perf.render(this.renderer, {
      activeParticles: this.effects.getActiveParticleCount(),
      activeMissiles: this.combat.missiles.length,
      terrainDetail: `${this.graphics.terrainSegments} seg`,
      quality: this.effectiveGraphicsLabel(),
    });
  }

  private updateCamera(dt: number) {
    const fm = this.player.controller.flightModel;

    // Free-look from the mouse.
    const mouseDelta = this.input.consumeMouseDelta();
    const sens = this.input.sensitivity;
    this.lookYawDeg = THREE.MathUtils.clamp(this.lookYawDeg - mouseDelta.x * sens * 0.15, -55, 55);
    this.lookPitchDeg = THREE.MathUtils.clamp(this.lookPitchDeg - mouseDelta.y * sens * 0.15, -30, 30);

    const noShake = this.state.settings.reducedScreenShake || this.state.settings.reducedMotion;
    if (noShake) this.tmpShake.set(0, 0, 0);
    else this.effects.getShakeOffset(this.tmpShake);

    // Populate the reusable rig input rather than allocating a new object each frame.
    this.rigInput.position.copy(fm.position);
    this.rigInput.quaternion.copy(fm.quaternion);
    this.rigInput.forward.copy(fm.getForward(this.tmpForward));
    this.rigInput.speed = fm.getSpeed();
    this.rigInput.afterburner = fm.afterburnerActive;
    this.rigInput.rollDeg = fm.getRollDegrees();
    this.rigInput.groundHeight = this.world.getSurfaceHeightAt(fm.position.x, fm.position.z);
    this.rigInput.lookYawDeg = this.lookYawDeg;
    this.rigInput.lookPitchDeg = this.lookPitchDeg;
    // `shake` already aliases tmpShake, and speedFov off means we hold the base FOV.
    if (!this.state.settings.speedFov) {
      this.rigInput.speed = 0;
      this.rigInput.afterburner = false;
    }

    this.cameraRig.update(this.camera, this.cameraMode, this.rigInput, dt);

    // Cockpit buffet: afterburner thrust, low-altitude turbulence and damage all add vibration.
    const health = this.player.controller.healthFraction();
    const lowAltTurbulence = fm.position.y < 90 ? 0.45 : 0;
    const vibration = Math.min(
      1,
      (fm.afterburnerActive ? 0.5 : 0) + lowAltTurbulence + (1 - health) * 0.6,
    );
    this.cockpit.update(dt, health, vibration, this.state.settings.reducedMotion);

    // Hide the player's own airframe in cockpit view so it does not occlude the eye point.
    this.player.visualRoot.visible = this.cameraMode !== 'cockpit';
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
    this.adaptive.setBasePixelRatio(
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, this.graphics.maxPixelRatio),
    );
  };

  private onContextLost = (event: Event) => {
    // Preventing the default lets the browser attempt a restore instead of killing the context.
    event.preventDefault();
    console.warn('[Game] WebGL context lost — pausing until it is restored.');
    if (this.state.screen === 'playing') this.togglePause(true);
  };

  private onContextRestored = () => {
    console.warn('[Game] WebGL context restored — reapplying renderer state.');
    applyRendererQuality(this.renderer, this.graphics);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
    this.cameraRig.snap();
  };

  // ------------------------------------------------------------------
  // HUD / Map data assembly
  // ------------------------------------------------------------------

  private computeHUDData(): HUDData {
    const fm = this.player.controller.flightModel;
    const speedKnots = fm.getSpeed() * MPS_TO_KNOTS;
    const altitudeFeet = fm.position.y * METERS_TO_FEET;
    const warnings: string[] = [];
    if (fm.stalling && fm.getSpeed() > 5) warnings.push('STALL');
    // Height above the surface, so the warnings also work over the mainland's hills.
    const agl = fm.position.y - this.world.getSurfaceHeightAt(fm.position.x, fm.position.z);
    if (agl < 250 && fm.velocity.y < -12) warnings.push('PULL UP');
    if (agl < 120) warnings.push('LOW ALTITUDE');
    if (this.combat.missiles.some((m) => m.owner === 'enemy' && m.target?.id === 'player' && m.alive)) warnings.push('MISSILE');
    if (this.player.locked) warnings.push('RADAR LOCK');
    if (this.mission.stage === 'landing' && !fm.gearDown) warnings.push('GEAR');
    if (this.mission.stage === 'rtb' && this.mission.boundaryWarningActive) warnings.push('RETURN TO CARRIER');
    if (this.mission.boundaryWarningActive && this.mission.stage !== 'rtb') warnings.push('BOUNDARY');
    if (!this.player.isAlive()) warnings.push('MISSION FAILED');

    const targets = this.liveTargets();
    const currentTarget = targets.find((t) => t.id === this.player.currentTargetId) ?? null;

    const waypoint = this.mission.currentWaypoint();
    const carrier = this.world.carrier;
    const waypointForHud =
      this.mission.stage === 'rtb' || this.mission.stage === 'landing' ? carrier.getPosition() :
      this.mission.stage === 'strike_armor' ? this.computeArmorCentroid() : waypoint;
    const waypointLabel =
      this.mission.stage === 'to_alpha' && this.missionId === 'iron_anvil' ? 'WAYPOINT COAST' :
      this.mission.stage === 'strike_armor' ? 'ARMOUR COLUMN' :
      this.mission.stage === 'to_alpha' ? 'WAYPOINT ALPHA' :
      this.mission.stage === 'to_bravo' ? 'WAYPOINT BRAVO' :
      this.mission.stage === 'strike_radar' ? 'RADAR SITE' :
      this.mission.stage === 'rtb' || this.mission.stage === 'landing' ? 'CVN RESOLUTE' : null;

    const radarContacts: HUDRadarContact[] = [];
    const fwd = fm.getForward();
    const right = fm.getRight();
    const toRel = (worldPos: THREE.Vector3) => {
      const toTarget = worldPos.clone().sub(fm.position);
      return { relForward: toTarget.dot(fwd), relRight: toTarget.dot(right) };
    };
    for (const e of this.enemies) {
      if (!e.isAlive()) continue;
      const rel = toRel(e.getPosition());
      radarContacts.push({ kind: 'enemy', ...rel, selected: e.id === this.player.currentTargetId });
    }
    for (const u of this.groundUnits) {
      if (!u.isAlive()) continue;
      radarContacts.push({ kind: 'ground', ...toRel(u.getPosition()), selected: u.id === this.player.currentTargetId });
    }
    if (this.groundTarget.active && this.groundTarget.isAlive()) {
      const rel = toRel(this.groundTarget.getPosition());
      radarContacts.push({ kind: 'ground', ...rel, selected: this.groundTarget.id === this.player.currentTargetId });
    }
    radarContacts.push({ kind: 'carrier', ...toRel(carrier.getPosition()) });
    if (waypointForHud) radarContacts.push({ kind: 'waypoint', ...toRel(waypointForHud) });

    let landingGuidance: LandingGuidance | null = null;
    if (this.mission.stage === 'rtb' || this.mission.stage === 'landing') {
      const local = CollisionSystem.localDeckPosition(fm.position, carrier);
      const idealGlideDrop = Math.max(0, local.z - CARRIER_LOCAL.arrestingZoneStart.z) * 0.05 + 8;
      const distanceToDeck = fm.position.distanceTo(carrier.getPosition());
      landingGuidance = {
        distanceToDeck,
        lineupOffset: THREE.MathUtils.clamp((local.x - CARRIER_LOCAL.deckCenterline) / 30, -1, 1),
        glideSlopeOffset: THREE.MathUtils.clamp((local.y - idealGlideDrop) / 20, -1, 1),
        recommendedSpeedKnots: 90,
        waveOff: speedKnots > 210 || Math.abs(local.x - CARRIER_LOCAL.deckCenterline) > 60,
      };
    }

    return {
      speedKnots,
      altitudeFeet,
      headingDeg: fm.getHeadingDegrees(),
      vsiFpm: fm.velocity.y * METERS_TO_FEET * 60,
      throttlePct: fm.throttle * 100,
      afterburner: fm.afterburnerActive,
      healthFraction: this.player.controller.healthFraction(),
      cannonAmmo: this.player.cannonAmmo,
      missilesRemaining: this.player.missileCount,
      missileLabel: MISSIONS[this.missionId].loadout.missileLabel,
      bombsRemaining: MISSIONS[this.missionId].loadout.bombs > 0 ? this.player.bombCount : null,
      bombPipper: this.computeBombPipper(),
      targetMarker: currentTarget ? this.projectToScreen(this.tmpImpact.copy(currentTarget.getPosition())) : null,
      selectedWeapon: this.player.locked ? 'missile' : 'cannon',
      gearDown: fm.gearDown,
      flapsDown: fm.flapsDown,
      targetLabel: currentTarget?.label ?? null,
      targetRange: currentTarget ? currentTarget.getPosition().distanceTo(fm.position) : null,
      lockProgress: this.player.lockProgress,
      locked: this.player.locked,
      waypointLabel,
      waypointDistance: waypointForHud ? fm.position.distanceTo(waypointForHud) : null,
      objectiveText: this.mission.objectiveText(),
      warnings,
      subtitle: this.mission.activeMessage?.text ?? null,
      pitchDeg: fm.getPitchDegrees(),
      rollDeg: fm.getRollDegrees(),
      cameraMode: this.cameraMode,
      radarContacts,
      radarRange: RADAR_RANGE,
      shootCue: this.player.locked || (currentTarget !== null && (currentTarget.getPosition().distanceTo(fm.position) < 420)),
      damageDirection: this.effects.damageFlashTimer > 0 && this.effects.lastDamageDirection
        ? { forward: this.effects.lastDamageDirection.dot(fwd), right: this.effects.lastDamageDirection.dot(right) }
        : null,
      landingGuidance,
    };
  }

  /** Centre of the surviving tanks, used as the strike waypoint. Null once none are left. */
  private computeArmorCentroid(): THREE.Vector3 | null {
    let n = 0;
    this.armorCentroid.set(0, 0, 0);
    for (const u of this.groundUnits) {
      if (u.unitKind !== 'tank' || !u.isAlive()) continue;
      this.armorCentroid.add(u.getPosition());
      n += 1;
    }
    return n > 0 ? this.armorCentroid.divideScalar(n) : null;
  }

  /**
   * CCIP: predicts where a bomb released this instant would land and projects that point through
   * the live camera. Returns null when no bombs are carried or the point is off-screen (which is
   * normal in level flight — the pipper comes into view as the nose drops toward the target).
   */
  private computeBombPipper(): { x: number; y: number } | null {
    if (this.player.bombCount <= 0 || this.launchPhase !== 'airborne' || !this.player.isAlive()) return null;
    const fm = this.player.controller.flightModel;
    if (!predictBombImpact(fm.position, fm.velocity, this.terrainHeightAt, this.tmpImpact, 1 / 20)) return null;
    return this.projectToScreen(this.tmpImpact);
  }

  /** Projects a world point (modified in place) through the live camera to 0..1 screen fractions. */
  private projectToScreen(point: THREE.Vector3): { x: number; y: number } | null {
    point.project(this.camera);
    if (point.z < -1 || point.z > 1) return null;
    if (Math.abs(point.x) > 0.96 || Math.abs(point.y) > 0.96) return null;
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
  }

  private computeMapContacts(): MapContact[] {
    const contacts: MapContact[] = [];
    const fm = this.player.controller.flightModel;
    contacts.push({ kind: 'player', x: fm.position.x, z: fm.position.z, headingDeg: fm.getHeadingDegrees(), label: 'VIPER 1' });
    const carrier = this.world.carrier;
    contacts.push({ kind: 'carrier', x: carrier.getPosition().x, z: carrier.getPosition().z, label: 'RESOLUTE' });
    for (const e of this.enemies) {
      if (!e.isAlive()) continue;
      contacts.push({ kind: 'enemy', x: e.getPosition().x, z: e.getPosition().z, label: 'KESTREL-9' });
    }
    if (this.missionId === 'broken_beacon' && this.groundTarget.isAlive()) {
      contacts.push({ kind: 'ground', x: this.groundTarget.getPosition().x, z: this.groundTarget.getPosition().z, label: 'RADAR' });
    }
    for (const u of this.groundUnits) {
      if (!u.isAlive()) continue;
      // Label only the lead tank and the flak so the column does not become a smear of text.
      const label = u.unitKind === 'flak' ? 'FLAK' : u.id === 'tank-1' ? 'ARMOUR' : undefined;
      contacts.push({ kind: 'ground', x: u.getPosition().x, z: u.getPosition().z, label });
    }
    const wp = this.mission.currentWaypoint();
    if (wp) {
      const label =
        this.missionId === 'iron_anvil' ? 'COAST' :
        this.mission.stage === 'to_alpha' ? 'ALPHA' : this.mission.stage === 'to_bravo' ? 'BRAVO' : 'TARGET';
      contacts.push({ kind: 'waypoint', x: wp.x, z: wp.z, label });
    }
    contacts.push({
      kind: 'island',
      x: this.world.terrain.mainIslandCenter.x,
      z: this.world.terrain.mainIslandCenter.z,
      radius: this.world.terrain.mainIslandRadius,
    });
    contacts.push({
      kind: 'island',
      x: WORLD_LAYOUT.mainland.x,
      z: WORLD_LAYOUT.mainland.z,
      radius: WORLD_LAYOUT.mainland.radius,
    });
    return contacts;
  }

  // ------------------------------------------------------------------
  // Subtitles / pause / map
  // ------------------------------------------------------------------

  private showSubtitle(speaker: string, text: string) {
    this.subtitleEl.textContent = `${speaker.toUpperCase()}: ${text}`;
    this.subtitleEl.style.display = 'block';
    this.audio.warningBeep();
    this.trySpeak(text);
  }

  private trySpeak(text: string) {
    if (this.state.settings.muted) return;
    try {
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.05;
        utter.volume = 0.6;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // speech synthesis is unavailable or blocked; subtitles alone are sufficient
    }
  }

  private stopSpeech() {
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch {
      // speech synthesis unavailable; nothing to stop
    }
  }

  private togglePause(forceState?: boolean) {
    const next = forceState !== undefined ? forceState : !this.state.paused;
    this.state.paused = next;
    if (next) {
      this.stopSpeech();
      this.state.screen = 'paused';
      this.pauseMenu.show();
    } else {
      this.state.screen = 'playing';
      this.pauseMenu.hide();
      this.settingsPanel.hide();
    }
  }

  private toggleMap() {
    if (this.tacticalMap.isVisible()) {
      this.tacticalMap.hide();
    } else if (!this.state.paused) {
      this.tacticalMap.show();
    }
  }

  private endMission(success: boolean, failReason?: string) {
    this.state.screen = success ? 'success' : 'failure';
    this.audio.stopEngine();
    this.stopSpeech();
    // Count actual kills: before the intercept stage no fighters exist, so none were destroyed.
    const enemiesDestroyed = this.enemies.filter((e) => !e.isAlive()).length;
    const strike = this.missionId === 'iron_anvil';
    const tanksTotal = this.groundUnits.filter((u) => u.unitKind === 'tank').length;
    const tanksDestroyed = tanksTotal - this.armorRemaining();
    const flakDestroyed = this.groundUnits.filter((u) => u.unitKind === 'flak' && !u.isAlive()).length;
    const launched = this.launchPhase === 'airborne';
    const landed = this.landingResult === 'success';
    const score = calculateScore({
      primaryTargetFraction: strike && tanksTotal > 0 ? tanksDestroyed / tanksTotal : undefined,
      enemiesDestroyed,
      radarDestroyed: this.groundTarget.destroyed,
      cannonAccuracy: this.combat.getAccuracy(),
      missilesRemaining: this.player.missileCount,
      playerHealthFraction: this.player.controller.healthFraction(),
      completionTimeSeconds: this.mission.elapsedTime,
      landedSuccessfully: this.landingResult === 'success',
      civilianStrikes: this.player.civilianStrikes,
    });
    if (!this.state.sessionBest || score.score > this.state.sessionBest.score) {
      this.state.sessionBest = { score: score.score, grade: score.grade };
      this.state.saveBest();
    }
    this.hud.setVisible(false);
    this.results.show({
      success,
      failReason,
      score,
      objectives: strike
        ? [
            { label: 'Launch from CVN Resolute', complete: launched },
            { label: `Destroy the armoured column (${tanksDestroyed}/${tanksTotal} tanks)`, complete: tanksDestroyed >= tanksTotal },
            { label: `Optional: flak vehicles destroyed (${flakDestroyed}/2)`, complete: flakDestroyed >= 2 },
            { label: 'Return and land on CVN Resolute', complete: landed },
          ]
        : [
            { label: 'Launch from CVN Resolute', complete: launched },
            { label: 'Destroy two Kestrel-9 fighters', complete: enemiesDestroyed >= 2 },
            { label: 'Destroy coastal radar site', complete: this.groundTarget.destroyed },
            { label: 'Return and land on CVN Resolute', complete: landed },
          ],
      missionName: MISSIONS[this.missionId].name,
      strike,
      accuracy: this.combat.getAccuracy(),
      completionTimeSeconds: this.mission.elapsedTime,
      landedSuccessfully: this.landingResult === 'success',
      sessionBest: this.state.sessionBest.score,
    });
  }
}
