import * as THREE from 'three';
import { WORLD_BOUNDARY_RADIUS, WORLD_BOUNDARY_WARN, WORLD_BOUNDARY_KILL_TIME } from './Constants';
import { WORLD_LAYOUT } from '../world/WorldBuilder';

export type MissionStage =
  | 'launch'
  | 'to_alpha'
  | 'intercept'
  | 'to_bravo'
  | 'strike_radar'
  | 'rtb'
  | 'landing'
  | 'success'
  | 'failed';

export interface RadioMessage {
  speaker: string;
  text: string;
  id: number;
}

export interface MissionUpdateInput {
  playerAlive: boolean;
  playerPosition: THREE.Vector3;
  enemiesRemaining: number;
  radarDestroyed: boolean;
  landedSuccessfully: boolean;
  civilianStrikes: number;
}

const WAYPOINT_ARRIVAL_RADIUS = 350;
const CIVILIAN_STRIKE_LIMIT = 3;

let messageCounter = 0;

export class MissionManager {
  stage: MissionStage = 'launch';
  failReason = '';
  elapsedTime = 0;
  private messageQueue: RadioMessage[] = [];
  activeMessage: RadioMessage | null = null;
  private activeMessageTimer = 0;
  private outsideBoundaryTimer = 0;
  boundaryWarningActive = false;
  private civilianWarned = false;

  reset() {
    this.stage = 'launch';
    this.failReason = '';
    this.elapsedTime = 0;
    this.messageQueue = [];
    this.activeMessage = null;
    this.activeMessageTimer = 0;
    this.outsideBoundaryTimer = 0;
    this.boundaryWarningActive = false;
    this.civilianWarned = false;
  }

  private queueMessage(speaker: string, text: string) {
    messageCounter += 1;
    this.messageQueue.push({ speaker, text, id: messageCounter });
  }

  /** Public hook for ad-hoc radio lines triggered by Game.ts (launch clearance, etc). */
  radioMessage(speaker: string, text: string) {
    this.queueMessage(speaker, text);
  }

  private setStage(stage: MissionStage) {
    if (this.stage === stage) return;
    this.stage = stage;
  }

  beginFlight() {
    this.setStage('to_alpha');
    this.queueMessage('Resolute Control', 'Viper One, you are clear of the deck. Proceed to waypoint Alpha.');
  }

  objectiveText(): string {
    switch (this.stage) {
      case 'launch':
        return 'Launch from CVN Resolute';
      case 'to_alpha':
        return 'Navigate to waypoint ALPHA';
      case 'intercept':
        return 'Destroy hostile fighters';
      case 'to_bravo':
        return 'Proceed to waypoint BRAVO';
      case 'strike_radar':
        return 'Destroy the coastal radar site';
      case 'rtb':
        return 'Return to CVN Resolute';
      case 'landing':
        return 'Land on CVN Resolute';
      case 'success':
        return 'Mission complete';
      case 'failed':
        return 'Mission failed';
      default:
        return '';
    }
  }

  currentWaypoint(): THREE.Vector3 | null {
    if (this.stage === 'to_alpha') return WORLD_LAYOUT.waypointAlpha;
    if (this.stage === 'to_bravo') return WORLD_LAYOUT.waypointBravo;
    if (this.stage === 'strike_radar') return WORLD_LAYOUT.radarSitePosition;
    return null;
  }

  update(dt: number, input: MissionUpdateInput) {
    if (this.stage === 'success' || this.stage === 'failed') return;
    this.elapsedTime += dt;

    if (this.activeMessage) {
      this.activeMessageTimer -= dt;
      if (this.activeMessageTimer <= 0) this.activeMessage = null;
    }
    if (!this.activeMessage && this.messageQueue.length > 0) {
      this.activeMessage = this.messageQueue.shift()!;
      this.activeMessageTimer = 4.2;
    }

    if (!input.playerAlive) {
      this.fail('Aircraft lost');
      return;
    }

    if (input.civilianStrikes >= CIVILIAN_STRIKE_LIMIT) {
      this.fail('Repeated attacks on protected civilian structures');
      return;
    } else if (input.civilianStrikes > 0 && !this.civilianWarned) {
      this.civilianWarned = true;
      this.queueMessage('Resolute Control', 'Viper One, that structure is not hostile! Check your fire.');
    }

    const distFromOrigin = Math.hypot(input.playerPosition.x, input.playerPosition.z);
    if (distFromOrigin > WORLD_BOUNDARY_RADIUS) {
      this.outsideBoundaryTimer += dt;
      this.boundaryWarningActive = true;
      if (this.outsideBoundaryTimer > WORLD_BOUNDARY_KILL_TIME) {
        this.fail('Left the combat area');
        return;
      }
    } else {
      this.outsideBoundaryTimer = 0;
      this.boundaryWarningActive = distFromOrigin > WORLD_BOUNDARY_WARN;
    }

    switch (this.stage) {
      case 'to_alpha': {
        const dist = input.playerPosition.distanceTo(WORLD_LAYOUT.waypointAlpha);
        if (dist < WAYPOINT_ARRIVAL_RADIUS) {
          this.setStage('intercept');
          this.queueMessage('Airborne Control', 'Radar contact, two bogeys inbound. Kestrel-9s, weapons free.');
        }
        break;
      }
      case 'intercept':
        if (input.enemiesRemaining <= 0) {
          this.setStage('to_bravo');
          this.queueMessage('Resolute Control', 'Splash both bandits, Viper One. Proceed to waypoint Bravo and take out that radar site.');
        }
        break;
      case 'to_bravo': {
        const dist = input.playerPosition.distanceTo(WORLD_LAYOUT.waypointBravo);
        if (dist < WAYPOINT_ARRIVAL_RADIUS) {
          this.setStage('strike_radar');
          this.queueMessage('Airborne Control', 'Radar station should be on your scope. Take it down.');
        }
        break;
      }
      case 'strike_radar':
        if (input.radarDestroyed) {
          this.setStage('rtb');
          this.queueMessage('Resolute Control', 'Good hit, Viper One. Radar is down. Return to Resolute for recovery.');
        }
        break;
      case 'rtb': {
        // Landing stage begins once the player is close enough to the carrier; Game drives the exact transition
        // once the aircraft is within the carrier's landing pattern, since that check needs the live carrier position.
        break;
      }
      default:
        break;
    }
  }

  /**
   * Development/testing only: jumps straight to the return-to-carrier stage.
   * Used by the automated recovery-and-landing verification run so it does not have to win the
   * dogfight first. Never called from gameplay code, and the caller is DEV-gated.
   */
  devJumpToRecovery() {
    this.setStage('rtb');
    this.queueMessage('Resolute Control', 'Viper One, return to Resolute for recovery.');
  }

  enterLandingStage() {
    if (this.stage === 'rtb') {
      this.setStage('landing');
      this.queueMessage('Resolute Control', 'Viper One, you are cleared to land. Gear and flaps down, call the ball.');
    }
  }

  completeSuccess() {
    this.setStage('success');
    this.queueMessage('Resolute Control', 'Nice trap, Viper One. Welcome home.');
  }

  fail(reason: string) {
    if (this.stage === 'failed') return;
    this.failReason = reason;
    this.setStage('failed');
    this.queueMessage('Resolute Control', 'Viper One, be advised: mission failed.');
  }
}
