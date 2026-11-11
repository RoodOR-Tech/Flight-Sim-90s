export type CameraMode = 'cockpit' | 'chase' | 'cinematic';
export type RadarContactKind = 'enemy' | 'carrier' | 'ground' | 'waypoint' | 'projectile';

export interface HUDRadarContact {
  kind: RadarContactKind;
  relForward: number; // meters, +forward relative to player nose
  relRight: number; // meters, +right relative to player nose
  selected?: boolean;
}

export interface HUDData {
  speedKnots: number;
  altitudeFeet: number;
  headingDeg: number;
  vsiFpm: number;
  throttlePct: number;
  afterburner: boolean;
  healthFraction: number;
  cannonAmmo: number;
  missilesRemaining: number;
  /** HUD label for the missile line, e.g. "MISSILES" or "AT MISSILES". */
  missileLabel: string;
  /** Null when the loadout carries no bombs. */
  bombsRemaining: number | null;
  /** Predicted bomb impact point in screen fractions (0..1), or null when off-screen / no bombs. */
  bombPipper: { x: number; y: number } | null;
  /** Screen position (0..1) of the selected target, or null when none / off-screen. */
  targetMarker: { x: number; y: number } | null;
  selectedWeapon: 'cannon' | 'missile';
  gearDown: boolean;
  flapsDown: boolean;
  targetLabel: string | null;
  targetRange: number | null;
  lockProgress: number;
  locked: boolean;
  waypointLabel: string | null;
  waypointDistance: number | null;
  objectiveText: string;
  warnings: string[];
  subtitle: string | null;
  pitchDeg: number;
  rollDeg: number;
  cameraMode: CameraMode;
  radarContacts: HUDRadarContact[];
  radarRange: number;
  shootCue: boolean;
  damageDirection: { forward: number; right: number } | null;
  landingGuidance: LandingGuidance | null;
}

export interface LandingGuidance {
  distanceToDeck: number;
  lineupOffset: number; // -1..1, negative = deck is to the left
  glideSlopeOffset: number; // -1..1, negative = below glideslope
  recommendedSpeedKnots: number;
  waveOff: boolean;
}

const GREEN = '#33ff66';
const GREEN_DIM = 'rgba(51,255,102,0.55)';
const AMBER = '#ffb000';
const RED = '#ff4444';

/** Draws the full retro monochrome-green HUD onto a full-screen 2D canvas each frame. */
export class HUD {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private warningBlink = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get width() {
    return this.canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
  }
  get height() {
    return this.canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
  }

  setVisible(v: boolean) {
    this.canvas.style.display = v ? 'block' : 'none';
  }

  render(data: HUDData, dt: number) {
    this.warningBlink += dt;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.font = '14px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 1.5;

    const cx = w / 2;
    const cy = h / 2;

    // A real 3D cockpit is drawn in the scene for cockpit view, so the HUD no longer paints its
    // own frame. Instead the data columns get a soft dark scrim, and every glyph gets a drop
    // shadow, so the green stays legible against bright water, sunlit haze or pale terrain.
    this.drawContrastScrims(w, h);
    ctx.shadowColor = 'rgba(0, 12, 4, 0.95)';
    ctx.shadowBlur = 4;
    ctx.lineJoin = 'round';

    this.drawHorizon(cx, cy, data.pitchDeg, data.rollDeg);
    this.drawReticle(cx, cy, data.shootCue);

    this.drawTape(20, cy, 'L', Math.round(data.speedKnots));
    this.drawTape(w - 90, cy, 'R', Math.round(data.altitudeFeet));

    // Each label group sets its own fill explicitly rather than inheriting, so no earlier draw
    // can silently blank the readouts.
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'left';
    ctx.fillText('SPD', 20, cy - 46);
    ctx.fillText('KTS', 20, cy + 46);
    ctx.textAlign = 'right';
    ctx.fillText('ALT', w - 20, cy - 46);
    ctx.fillText('FT', w - 20, cy + 46);

    // Heading tape
    this.drawHeadingTape(cx, 26, data.headingDeg);

    // VSI
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'left';
    const vsiSign = data.vsiFpm >= 0 ? '+' : '';
    ctx.fillText(`VSI ${vsiSign}${Math.round(data.vsiFpm)} FPM`, 20, cy + 90);

    // Throttle / afterburner
    ctx.fillText(`THR ${Math.round(data.throttlePct)}%`, 20, cy + 112);
    if (data.afterburner) {
      ctx.fillStyle = AMBER;
      ctx.fillText('AFTERBURNER', 20, cy + 134);
      ctx.fillStyle = GREEN;
    }

    // Health
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'left';
    ctx.fillText('AC HEALTH', 20, h - 130);
    this.drawBar(20, h - 112, 140, 12, data.healthFraction, data.healthFraction < 0.3 ? RED : GREEN);

    // Gear / flaps
    ctx.fillStyle = data.gearDown ? GREEN : AMBER;
    ctx.fillText(`GEAR ${data.gearDown ? 'DOWN' : 'UP'}`, 20, h - 88);
    ctx.fillStyle = data.flapsDown ? GREEN : GREEN_DIM;
    ctx.fillText(`FLAPS ${data.flapsDown ? 'DOWN' : 'UP'}`, 20, h - 66);
    ctx.fillStyle = GREEN;

    // Weapons
    ctx.textAlign = 'right';
    ctx.fillText(`WEAPON: ${data.selectedWeapon === 'cannon' ? 'CANNON' : 'MISSILE'}`, w - 20, h - 130);
    ctx.fillText(`CANNON ${data.cannonAmmo}`, w - 20, h - 108);
    ctx.fillText(`${data.missileLabel} ${data.missilesRemaining}/4`, w - 20, h - 86);
    if (data.bombsRemaining !== null) {
      ctx.fillText(`BOMBS ${data.bombsRemaining}`, w - 20, h - 64);
    }
    if (data.bombPipper) this.drawBombPipper(data.bombPipper.x * w, data.bombPipper.y * h);
    if (data.targetMarker) this.drawTargetBox(data.targetMarker.x * w, data.targetMarker.y * h, data.locked);

    // Target info
    if (data.targetLabel) {
      ctx.textAlign = 'left';
      ctx.fillText(`TGT: ${data.targetLabel}`, cx + 90, 60);
      if (data.targetRange !== null) ctx.fillText(`RNG: ${Math.round(data.targetRange)} M`, cx + 90, 80);
      const lockColor = data.locked ? RED : AMBER;
      ctx.fillStyle = lockColor;
      if (data.locked) {
        ctx.fillText('RADAR LOCK', cx + 90, 100);
      } else if (data.lockProgress > 0) {
        ctx.fillText(`LOCKING ${Math.round(data.lockProgress * 100)}%`, cx + 90, 100);
      }
      ctx.fillStyle = GREEN;
    }

    // Mission objective / waypoint
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'center';
    ctx.fillText(data.objectiveText.toUpperCase(), cx, 60);
    if (data.waypointLabel && data.waypointDistance !== null) {
      ctx.fillText(`${data.waypointLabel}  ${(data.waypointDistance / 1000).toFixed(1)} KM`, cx, 80);
    }

    // Warnings
    if (data.warnings.length > 0) {
      const blink = Math.sin(this.warningBlink * 8) > -0.2;
      if (blink) {
        ctx.fillStyle = RED;
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(data.warnings.join('   '), cx, cy + 150);
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = GREEN;
      }
    }

    // Subtitle radio message
    // (rendered via HTML overlay in Game/BriefingScreen for crisper text; HUD leaves space clear)

    // Damage direction indicator
    if (data.damageDirection) {
      const angle = Math.atan2(data.damageDirection.right, data.damageDirection.forward);
      const r = 120;
      const dx = cx + Math.sin(angle) * r;
      const dy = cy - Math.cos(angle) * r;
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(dx, dy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = GREEN;
      ctx.fillStyle = GREEN;
    }

    this.drawRadarScope(w - 130, h - 250, 100, data.radarContacts, data.radarRange);

    if (data.landingGuidance) {
      this.drawLandingGuidance(cx, cy, data.landingGuidance);
    }

    ctx.restore();
  }

  /**
   * Soft dark gradients behind the left/right data columns and the top/bottom bands.
   * Keeps HUD text at readable contrast over sun glint or pale sky without boxing it in.
   */
  private drawContrastScrims(w: number, h: number) {
    const ctx = this.ctx;
    // save/restore is essential here: several HUD labels draw with the inherited fillStyle, so
    // leaking a gradient out of this method makes them invisible.
    ctx.save();
    const colWidth = Math.max(150, w * 0.16);

    // Left column
    const left = ctx.createLinearGradient(0, 0, colWidth, 0);
    left.addColorStop(0, 'rgba(0, 10, 5, 0.5)');
    left.addColorStop(1, 'rgba(0, 10, 5, 0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, colWidth, h);

    // Right column
    const right = ctx.createLinearGradient(w, 0, w - colWidth, 0);
    right.addColorStop(0, 'rgba(0, 10, 5, 0.5)');
    right.addColorStop(1, 'rgba(0, 10, 5, 0)');
    ctx.fillStyle = right;
    ctx.fillRect(w - colWidth, 0, colWidth, h);

    // Top band behind the heading tape and objective text
    const top = ctx.createLinearGradient(0, 0, 0, 110);
    top.addColorStop(0, 'rgba(0, 10, 5, 0.45)');
    top.addColorStop(1, 'rgba(0, 10, 5, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, 110);
    ctx.restore();
  }

  private drawTape(x: number, cy: number, _side: string, value: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = GREEN;
    ctx.strokeRect(x, cy - 20, 62, 40);
    ctx.fillStyle = GREEN;
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(value), x + 31, cy);
    ctx.font = '14px "Courier New", monospace';
  }

  private drawHeadingTape(cx: number, y: number, headingDeg: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 160, y - 14, 320, 28);
    ctx.clip();
    const pxPerDeg = 4;
    for (let d = -45; d <= 45; d += 5) {
      const heading = ((Math.round(headingDeg / 5) * 5 + d) % 360 + 360) % 360;
      const offset = d - (headingDeg % 5);
      const x = cx + offset * pxPerDeg;
      const isMajor = heading % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y - (isMajor ? 10 : 6));
      ctx.lineTo(x, y);
      ctx.stroke();
      if (isMajor) {
        ctx.textAlign = 'center';
        const label = heading === 0 ? 'N' : heading === 90 ? 'E' : heading === 180 ? 'S' : heading === 270 ? 'W' : String(heading);
        ctx.fillText(label, x, y - 18);
      }
    }
    ctx.restore();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, y + 2);
    ctx.lineTo(cx - 6, y + 12);
    ctx.lineTo(cx + 6, y + 12);
    ctx.closePath();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(headingDeg).toString().padStart(3, '0')}`, cx, y + 28);
  }

  private drawHorizon(cx: number, cy: number, pitchDeg: number, rollDeg: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-(rollDeg * Math.PI) / 180);
    const pxPerDeg = 4.2;
    ctx.strokeStyle = GREEN_DIM;
    for (let d = -80; d <= 80; d += 10) {
      if (d === 0) continue;
      const y = -(d - pitchDeg) * pxPerDeg;
      if (Math.abs(y) > 170) continue;
      const lineLen = d % 20 === 0 ? 46 : 26;
      ctx.beginPath();
      ctx.moveTo(-lineLen, y);
      ctx.lineTo(lineLen, y);
      ctx.stroke();
      if (d % 20 === 0) {
        ctx.fillStyle = GREEN_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(String(d), lineLen + 4, y);
      }
    }
    const horizonY = -(0 - pitchDeg) * pxPerDeg;
    if (Math.abs(horizonY) < 200) {
      ctx.strokeStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(-90, horizonY);
      ctx.lineTo(90, horizonY);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Designator box around the selected target, so small or distant targets can be found. */
  private drawTargetBox(x: number, y: number, locked: boolean) {
    const ctx = this.ctx;
    const r = 16;
    const k = 6;
    ctx.strokeStyle = locked ? RED : GREEN;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * r, y + sy * (r - k));
      ctx.lineTo(x + sx * r, y + sy * r);
      ctx.lineTo(x + sx * (r - k), y + sy * r);
    }
    ctx.stroke();
    ctx.strokeStyle = GREEN;
  }

  /** CCIP pipper: where a bomb released right now will land. */
  private drawBombPipper(x: number, y: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x - 11, y);
    ctx.moveTo(x + 11, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 11);
    ctx.stroke();
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.textAlign = 'center';
    ctx.fillText('CCIP', x, y + 24);
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
  }

  private drawReticle(cx: number, cy: number, shootCue: boolean) {
    const ctx = this.ctx;
    ctx.strokeStyle = shootCue ? AMBER : GREEN;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 16, cy);
    ctx.moveTo(cx + 16, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy - 16);
    ctx.moveTo(cx, cy + 16);
    ctx.lineTo(cx, cy + 26);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    if (shootCue) {
      ctx.fillStyle = AMBER;
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText('SHOOT', cx, cy + 44);
      ctx.font = '14px "Courier New", monospace';
      ctx.fillStyle = GREEN;
    }
  }

  private drawBar(x: number, y: number, w: number, h: number, frac: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = GREEN;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * frac), h - 2);
    ctx.fillStyle = GREEN;
  }

  private drawRadarScope(cx: number, cy: number, radius: number, contacts: HUDRadarContact[], range: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // player marker (nose-up radar)
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();

    for (const c of contacts) {
      const scale = radius / range;
      const px = cx + c.relRight * scale;
      const py = cy - c.relForward * scale;
      if (Math.hypot(px - cx, py - cy) > radius) continue;
      ctx.strokeStyle = c.kind === 'enemy' ? RED : c.kind === 'carrier' ? GREEN : c.kind === 'ground' ? AMBER : GREEN_DIM;
      ctx.fillStyle = ctx.strokeStyle;
      if (c.kind === 'enemy') {
        ctx.beginPath();
        ctx.moveTo(px, py - 4);
        ctx.lineTo(px + 4, py);
        ctx.lineTo(px, py + 4);
        ctx.lineTo(px - 4, py);
        ctx.closePath();
        c.selected ? ctx.fill() : ctx.stroke();
      } else if (c.kind === 'carrier') {
        ctx.strokeRect(px - 4, py - 4, 8, 8);
      } else if (c.kind === 'ground') {
        ctx.beginPath();
        ctx.moveTo(px - 4, py + 4);
        ctx.lineTo(px + 4, py + 4);
        ctx.lineTo(px, py - 4);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawLandingGuidance(cx: number, cy: number, g: import('./HUD').LandingGuidance) {
    const ctx = this.ctx;
    const boxSize = 90;
    const bx = cx - boxSize / 2;
    const by = cy - 220;
    ctx.strokeStyle = GREEN_DIM;
    ctx.strokeRect(bx, by, boxSize, boxSize);
    ctx.beginPath();
    ctx.moveTo(bx, by + boxSize / 2);
    ctx.lineTo(bx + boxSize, by + boxSize / 2);
    ctx.moveTo(bx + boxSize / 2, by);
    ctx.lineTo(bx + boxSize / 2, by + boxSize);
    ctx.stroke();
    const dotX = bx + boxSize / 2 + Math.max(-1, Math.min(1, g.lineupOffset)) * (boxSize / 2 - 6);
    const dotY = by + boxSize / 2 - Math.max(-1, Math.min(1, g.glideSlopeOffset)) * (boxSize / 2 - 6);
    ctx.strokeStyle = g.waveOff ? RED : GREEN;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = GREEN;
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`DECK ${Math.round(g.distanceToDeck)}M  REC SPD ${Math.round(g.recommendedSpeedKnots)} KT`, cx, by - 10);
    if (g.waveOff) {
      ctx.fillStyle = RED;
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText('WAVE OFF', cx, by + boxSize + 18);
      ctx.font = '14px "Courier New", monospace';
      ctx.fillStyle = GREEN;
    }
  }

  dispose() {
    this.canvas.remove();
  }
}
