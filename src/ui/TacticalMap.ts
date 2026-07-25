export interface MapContact {
  kind: 'player' | 'enemy' | 'carrier' | 'ground' | 'waypoint' | 'island';
  x: number;
  z: number;
  label?: string;
  radius?: number;
  headingDeg?: number;
}

const GREEN = '#33ff66';
const GREEN_DIM = 'rgba(51,255,102,0.4)';
const RED = '#ff4444';
const AMBER = '#ffb000';

/** Top-down tactical map overlay (toggled with M). North-up, fixed world-space scale. */
export class TacticalMap {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private worldRadius = 9000;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.el.innerHTML = `
      <div class="crt-panel" style="width:min(760px,90vw);">
        <div class="title-block">
          <h1 class="title-main" style="font-size:1.6rem;">TACTICAL MAP</h1>
          <div class="title-sub">PRESS M TO RESUME FLIGHT</div>
        </div>
        <div class="map-canvas-holder"><canvas width="620" height="620"></canvas></div>
      </div>
    `;
    container.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
  }

  show() {
    this.el.classList.remove('hidden');
  }
  hide() {
    this.el.classList.add('hidden');
  }
  isVisible() {
    return !this.el.classList.contains('hidden');
  }

  render(contacts: MapContact[], objectiveText: string) {
    const ctx = this.ctx;
    const size = this.canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const scale = (size / 2 - 20) / this.worldRadius;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#03170a';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = GREEN_DIM;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 20, 0, Math.PI * 2);
    ctx.stroke();
    for (let r = 0.25; r < 1; r += 0.25) {
      ctx.beginPath();
      ctx.arc(cx, cy, (size / 2 - 20) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, 20);
    ctx.lineTo(cx, size - 20);
    ctx.moveTo(20, cy);
    ctx.lineTo(size - 20, cy);
    ctx.stroke();
    ctx.fillStyle = GREEN_DIM;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 14);

    for (const c of contacts) {
      const px = cx + c.x * scale;
      const py = cy - c.z * scale;
      if (c.kind === 'island') {
        ctx.strokeStyle = 'rgba(150,150,120,0.6)';
        ctx.beginPath();
        ctx.arc(px, py, (c.radius ?? 100) * scale, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = c.kind === 'player' ? GREEN : c.kind === 'enemy' ? RED : c.kind === 'carrier' ? GREEN : c.kind === 'ground' ? AMBER : GREEN_DIM;
      ctx.strokeStyle = ctx.fillStyle;

      if (c.kind === 'player') {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(((c.headingDeg ?? 0) * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6, 8);
        ctx.lineTo(0, 4);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (c.kind === 'enemy') {
        ctx.beginPath();
        ctx.moveTo(px, py - 6);
        ctx.lineTo(px + 6, py);
        ctx.lineTo(px, py + 6);
        ctx.lineTo(px - 6, py);
        ctx.closePath();
        ctx.fill();
      } else if (c.kind === 'carrier') {
        ctx.fillRect(px - 5, py - 5, 10, 10);
      } else if (c.kind === 'ground') {
        ctx.beginPath();
        ctx.moveTo(px - 6, py + 6);
        ctx.lineTo(px + 6, py + 6);
        ctx.lineTo(px, py - 6);
        ctx.closePath();
        ctx.fill();
      } else if (c.kind === 'waypoint') {
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (c.label) {
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(c.label, px + 9, py);
      }
    }

    ctx.fillStyle = GREEN;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(objectiveText.toUpperCase(), cx, size - 6);
  }
}
