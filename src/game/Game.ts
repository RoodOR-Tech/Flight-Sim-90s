import * as THREE from 'three';
import { GameState } from './GameState';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { MissionManager } from './MissionManager';
import { WorldBuilder, WORLD_LAYOUT } from '../world/WorldBuilder';
import { PlayerAircraft } from '../entities/PlayerAircraft';
import { EnemyAircraft } from '../entities/EnemyAircraft';
import { GroundTarget } from '../entities/GroundTarget';
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

type CameraMode = 'cockpit' | 'chase' | 'cinematic';
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

  private cameraMode: CameraMode = 'chase';
  private cameraModeChanged = true;
  private lookYawDeg = 0;
  private lookPitchDeg = 0;
  private launchPhase: LaunchPhase = 'none';
  private catapultTimer = 0;
  private lastMessageId = -1;
  private missionStartElapsed = 0;
  private accumulator = 0;
  private lastTime = performance.now();
  private frameCount = 0;
  private fpsTimer = 0;
  private landingResult: 'pending' | 'success' | 'crash' = 'pending';

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 8500);

    this.world = new WorldBuilder(this.scene);
    this.effects = new EffectsSystem(this.scene);

    this.input = new InputManager(canvas);
    this.playerInputAdapter = new PlayerInputAdapter(this.input);

    this.hud = new HUD(uiRoot);
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
    window.addEventListener('resize', () => this.onResize());

    this.hud.setVisible(false);
    this.showLoading();
  }

  private get worldBuilder(): WorldBuilder {
    return this.world;
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

  private showLoading() {
    this.state.screen = 'loading';
    let progress = 0;
    const step = () => {
      progress += 0.14;
      this.loading.setProgress(Math.min(1, progress));
      if (progress >= 1) {
        this.loading.hide();
        this.goToTitle();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
    this.startLoop();
  }

  private goToTitle() {
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
    this.input.sensitivity = s.mouseSensitivity;
  }

  // ------------------------------------------------------------------
  // Mission lifecycle
  // ------------------------------------------------------------------

  private startMission(result: BriefingResult) {
    this.state.settings.difficulty = result.difficulty;
    this.state.skipCarrierLaunch = result.skipLaunch;
    this.applySettings(this.state.settings);
    this.audio.resume();
    this.audio.startEngine();
    this.setupEntities();
    this.mission.reset();
    this.combat.reset(this.scene);
    this.missionStartElapsed = 0;
    this.landingResult = 'pending';
    this.lastMessageId = -1;

    if (result.skipLaunch) {
      this.launchPhase = 'airborne';
      const carrier = this.worldBuilder.carrier;
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
    this.startMission({ difficulty: this.state.settings.difficulty, skipLaunch: this.state.skipCarrierLaunch });
  }

  private setupEntities() {
    if (this.player) this.scene.remove(this.player.visual.group);
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    if (this.groundTarget) this.scene.remove(this.groundTarget.group);

    this.player = new PlayerAircraft(this.scene);
    this.groundTarget = new GroundTarget(this.scene, WORLD_LAYOUT.radarSitePosition.clone());
  }

  private placeOnCatapult() {
    const carrier = this.worldBuilder.carrier;
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
      let rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      rawDt = Math.min(rawDt, MAX_FRAME_DT);

      this.frameCount += 1;
      this.fpsTimer += rawDt;
      if (this.fpsTimer >= 0.5) {
        this.fpsEl.textContent = `${Math.round(this.frameCount / this.fpsTimer)} FPS`;
        this.frameCount = 0;
        this.fpsTimer = 0;
      }

      if (this.state.screen === 'playing' || this.state.screen === 'paused') {
        if (this.input.consumeJustPressed('pause') || this.input.consumeJustPressed('menu')) {
          this.togglePause();
        }
      }

      if (this.state.screen === 'playing') {
        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= FIXED_TIMESTEP && steps < 6) {
          this.fixedUpdate(FIXED_TIMESTEP);
          this.accumulator -= FIXED_TIMESTEP;
          steps += 1;
        }
      }
      this.input.endFrame();
      this.render(rawDt);
    };
    requestAnimationFrame(loop);
  }

  private fixedUpdate(dt: number) {
    if (this.input.consumeJustPressed('toggleMap')) {
      this.toggleMap();
    }
    if (this.state.paused || this.tacticalMap.isVisible()) return;

    this.worldBuilder.update(dt, this.mission.elapsedTime + this.missionStartElapsed);
    this.groundTarget.update(dt, this.mission.elapsedTime);

    if (this.input.consumeJustPressed('cycleCamera')) {
      this.cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length];
      this.cameraModeChanged = true;
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
      const carrier = this.worldBuilder.carrier;
      const { start } = carrier.getCatapultWorld();
      this.player.controller.flightModel.position.copy(start);
      this.player.controller.flightModel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), carrier.getForward());
      this.player.controller.syncMesh();
    } else if (this.launchPhase === 'catapult') {
      this.catapultTimer += dt;
      const t = Math.min(1, this.catapultTimer / CATAPULT_DURATION);
      const carrier = this.worldBuilder.carrier;
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
      this.updateCombat(dt);
      this.updateCrashChecks(dt);
      this.updateLandingLogic(dt);
    }

    this.effects.update(dt);
    this.audio.updateEngine(this.player.controller.flightModel.throttle, this.player.controller.flightModel.afterburnerActive);

    this.mission.update(dt, {
      playerAlive: this.player.controller.alive,
      playerPosition: this.player.getPosition(),
      enemiesRemaining: this.enemies.filter((e) => e.isAlive()).length,
      radarDestroyed: this.groundTarget.destroyed,
      landedSuccessfully: this.landingResult === 'success',
      civilianStrikes: this.player.civilianStrikes,
    });

    if (this.mission.stage === 'strike_radar' && !this.groundTarget.active) {
      this.groundTarget.active = true;
    }
    if (this.mission.stage === 'intercept' && this.enemies.length === 0) {
      this.spawnEnemies();
    }

    if (this.mission.stage === 'rtb') {
      const carrier = this.worldBuilder.carrier;
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
    this.enemies.push(new EnemyAircraft(this.scene, WORLD_LAYOUT.enemySpawnA.clone(), diff));
    this.enemies.push(new EnemyAircraft(this.scene, WORLD_LAYOUT.enemySpawnB.clone(), diff));
  }

  private updateLaunchSequence() {
    if (this.launchPhase !== 'onDeck') return;
    if (this.player.controller.flightModel.throttle >= 0.97) {
      this.launchPhase = 'catapult';
      this.catapultTimer = 0;
    }
  }

  private handleWeaponsInput(_dt: number) {
    const targets: Targetable[] = [...this.enemies.filter((e) => e.isAlive())];
    if (this.groundTarget.active && this.groundTarget.isAlive()) targets.push(this.groundTarget);

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
    const hostileTargets: Targetable[] = [...this.enemies.filter((e) => e.isAlive())];
    if (this.groundTarget.active && this.groundTarget.isAlive()) hostileTargets.push(this.groundTarget);
    const events = this.combat.update(dt, {
      scene: this.scene,
      player: this.player,
      hostileTargets,
      civilianStructures: this.worldBuilder.terrain.civilianStructures,
      effects: this.effects,
      audio: this.audio,
    });
    for (const ev of events) {
      if (ev.type === 'civilian-hit') this.player.civilianStrikes += 1;
      if (ev.type === 'target-destroyed' && ev.targetId === this.groundTarget.id) {
        this.effects.smokePuff(this.groundTarget.getPosition(), 5);
      }
    }
  }

  private updateCrashChecks(_dt: number) {
    if (!this.player.isAlive()) return;
    const pos = this.player.getPosition();
    const carrier = this.worldBuilder.carrier;
    const contact = CollisionSystem.carrierContact(pos, carrier);

    if (contact === 'hull') {
      this.crashPlayer();
      return;
    }
    if (contact === 'none') {
      if (CollisionSystem.oceanCrash(pos) || CollisionSystem.terrainCrash(pos, this.worldBuilder.terrain, this.player.getCollisionRadius())) {
        this.crashPlayer();
        return;
      }
    }
    for (const enemy of this.enemies) {
      if (!enemy.isAlive()) continue;
      if (CollisionSystem.aircraftCollision(pos, this.player.getCollisionRadius(), enemy.getPosition(), enemy.getCollisionRadius())) {
        this.crashPlayer();
        enemy.applyDamage(999);
        this.effects.explosion(enemy.getPosition(), 1.4);
        return;
      }
    }
  }

  private crashPlayer() {
    if (!this.player.isAlive()) return;
    this.effects.explosion(this.player.getPosition(), 1.6);
    this.audio.explosion();
    this.player.controller.applyDamage(999);
  }

  private updateLandingLogic(_dt: number) {
    if (this.mission.stage !== 'landing') return;
    const pos = this.player.getPosition();
    const carrier = this.worldBuilder.carrier;
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
    if (this.state.screen === 'playing' && !this.state.paused && !this.tacticalMap.isVisible()) {
      this.updateCamera(rawDt);
      this.hud.render(this.computeHUDData(), rawDt);
    } else {
      this.input.consumeMouseDelta();
    }
    if (this.tacticalMap.isVisible()) {
      this.tacticalMap.render(this.computeMapContacts(), this.mission.objectiveText());
    }
    this.fpsEl.style.display = this.state.settings.showFps ? 'block' : 'none';
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(_dt: number) {
    const fm = this.player.controller.flightModel;
    const shake = this.state.settings.reducedScreenShake ? new THREE.Vector3() : this.effects.getShakeOffset();

    const mouseDelta = this.input.consumeMouseDelta();
    const sens = this.input.sensitivity;
    this.lookYawDeg = THREE.MathUtils.clamp(this.lookYawDeg - mouseDelta.x * sens * 0.15, -55, 55);
    this.lookPitchDeg = THREE.MathUtils.clamp(this.lookPitchDeg - mouseDelta.y * sens * 0.15, -30, 30);
    const lookQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(this.lookPitchDeg), THREE.MathUtils.degToRad(this.lookYawDeg), 0, 'YXZ'),
    );

    if (this.cameraMode === 'cockpit') {
      const offset = new THREE.Vector3(0, 0.55, -0.3).applyQuaternion(fm.quaternion);
      this.camera.position.copy(fm.position).add(offset).add(shake);
      this.camera.quaternion.copy(fm.quaternion).multiply(lookQuat);
    } else {
      const back = this.cameraMode === 'chase' ? 7.5 : 26;
      const up = this.cameraMode === 'chase' ? 2.4 : 8;
      const orientedQuat = fm.quaternion.clone().multiply(lookQuat);
      const offset = new THREE.Vector3(0, up, back).applyQuaternion(orientedQuat);
      const desired = fm.position.clone().add(offset);
      if (this.cameraModeChanged) {
        this.camera.position.copy(desired).add(shake);
      } else {
        this.camera.position.lerp(desired.add(shake), this.cameraMode === 'chase' ? 0.35 : 0.12);
      }
      const lookTarget = fm.position.clone().addScaledVector(fm.getForward(), 8);
      this.camera.lookAt(lookTarget);
    }
    this.cameraModeChanged = false;
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------
  // HUD / Map data assembly
  // ------------------------------------------------------------------

  private computeHUDData(): HUDData {
    const fm = this.player.controller.flightModel;
    const speedKnots = fm.getSpeed() * MPS_TO_KNOTS;
    const altitudeFeet = fm.position.y * METERS_TO_FEET;
    const warnings: string[] = [];
    if (fm.stalling && fm.getSpeed() > 5) warnings.push('STALL');
    if (fm.position.y < 250 && fm.velocity.y < -12) warnings.push('PULL UP');
    if (fm.position.y < 120) warnings.push('LOW ALTITUDE');
    if (this.combat.missiles.some((m) => m.owner === 'enemy' && m.target?.id === 'player' && m.alive)) warnings.push('MISSILE');
    if (this.player.locked) warnings.push('RADAR LOCK');
    if (this.mission.stage === 'landing' && !fm.gearDown) warnings.push('GEAR');
    if (this.mission.stage === 'rtb' && this.mission.boundaryWarningActive) warnings.push('RETURN TO CARRIER');
    if (this.mission.boundaryWarningActive && this.mission.stage !== 'rtb') warnings.push('BOUNDARY');
    if (!this.player.isAlive()) warnings.push('MISSION FAILED');

    const targets: Targetable[] = [...this.enemies.filter((e) => e.isAlive())];
    if (this.groundTarget.active && this.groundTarget.isAlive()) targets.push(this.groundTarget);
    const currentTarget = targets.find((t) => t.id === this.player.currentTargetId) ?? null;

    const waypoint = this.mission.currentWaypoint();
    const carrier = this.worldBuilder.carrier;
    const waypointForHud = this.mission.stage === 'rtb' || this.mission.stage === 'landing' ? carrier.getPosition() : waypoint;
    const waypointLabel =
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

  private computeMapContacts(): MapContact[] {
    const contacts: MapContact[] = [];
    const fm = this.player.controller.flightModel;
    contacts.push({ kind: 'player', x: fm.position.x, z: fm.position.z, headingDeg: fm.getHeadingDegrees(), label: 'VIPER 1' });
    const carrier = this.worldBuilder.carrier;
    contacts.push({ kind: 'carrier', x: carrier.getPosition().x, z: carrier.getPosition().z, label: 'RESOLUTE' });
    for (const e of this.enemies) {
      if (!e.isAlive()) continue;
      contacts.push({ kind: 'enemy', x: e.getPosition().x, z: e.getPosition().z, label: 'KESTREL-9' });
    }
    if (this.groundTarget.isAlive()) {
      contacts.push({ kind: 'ground', x: this.groundTarget.getPosition().x, z: this.groundTarget.getPosition().z, label: 'RADAR' });
    }
    const wp = this.mission.currentWaypoint();
    if (wp) {
      const label = this.mission.stage === 'to_alpha' ? 'ALPHA' : this.mission.stage === 'to_bravo' ? 'BRAVO' : 'TARGET';
      contacts.push({ kind: 'waypoint', x: wp.x, z: wp.z, label });
    }
    contacts.push({
      kind: 'island',
      x: this.worldBuilder.terrain.mainIslandCenter.x,
      z: this.worldBuilder.terrain.mainIslandCenter.z,
      radius: this.worldBuilder.terrain.mainIslandRadius,
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

  private togglePause(forceState?: boolean) {
    const next = forceState !== undefined ? forceState : !this.state.paused;
    this.state.paused = next;
    if (next) {
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
    const enemiesDestroyed = 2 - this.enemies.filter((e) => e.isAlive()).length;
    const score = calculateScore({
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
    }
    this.hud.setVisible(false);
    this.results.show({
      success,
      failReason,
      score,
      objectives: [
        { label: 'Launch from CVN Resolute', complete: true },
        { label: 'Destroy two Kestrel-9 fighters', complete: enemiesDestroyed >= 2 },
        { label: 'Destroy coastal radar site', complete: this.groundTarget.destroyed },
        { label: 'Return and land on CVN Resolute', complete: this.landingResult === 'success' },
      ],
      accuracy: this.combat.getAccuracy(),
      completionTimeSeconds: this.mission.elapsedTime,
      landedSuccessfully: this.landingResult === 'success',
      sessionBest: this.state.sessionBest.score,
    });
  }
}
