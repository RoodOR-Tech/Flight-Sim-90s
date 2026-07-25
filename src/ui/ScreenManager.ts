import { Settings } from '../game/GameState';
import { Difficulty } from '../game/Constants';

export class LoadingScreen {
  el: HTMLElement;
  private bar: HTMLElement;
  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.innerHTML = `
      <div class="title-block">
        <h1 class="title-main">OPERATION BROKEN BEACON</h1>
        <div class="title-sub">INITIALIZING FLIGHT SYSTEMS...</div>
        <div class="loading-bar-outer"><div class="loading-bar-inner"></div></div>
      </div>
    `;
    container.appendChild(this.el);
    this.bar = this.el.querySelector('.loading-bar-inner')!;
  }
  setProgress(frac: number) {
    this.bar.style.width = `${Math.round(frac * 100)}%`;
  }
  hide() {
    this.el.classList.add('hidden');
  }
}

export class TitleScreen {
  el: HTMLElement;
  private onStartCb: (() => void) | null = null;
  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.el.innerHTML = `
      <div class="title-block">
        <h1 class="title-main">OPERATION<br/>BROKEN BEACON</h1>
        <div class="title-sub">AN ORIGINAL RETRO NAVAL COMBAT FLIGHT SIMULATOR</div>
        <div style="margin-top:36px;">
          <button class="hud-button" id="title-start-btn">START</button>
        </div>
        <div style="margin-top:26px; font-size:0.75rem; color:var(--hud-green-dim); max-width:520px;">
          Press ENTER or click START to view the mission briefing. Fictional aircraft, carrier and
          combatants &mdash; not affiliated with or depicting any real-world or licensed military simulator.
        </div>
      </div>
    `;
    container.appendChild(this.el);
    this.el.querySelector('#title-start-btn')!.addEventListener('click', () => this.onStartCb?.());
  }
  onStart(cb: () => void) {
    this.onStartCb = cb;
  }
  show() {
    this.el.classList.remove('hidden');
  }
  hide() {
    this.el.classList.add('hidden');
  }
}

export class PauseMenu {
  el: HTMLElement;
  constructor(
    container: HTMLElement,
    handlers: { onResume: () => void; onRestart: () => void; onSettings: () => void; onQuitToTitle: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.el.innerHTML = `
      <div class="crt-panel" style="width:380px; text-align:center;">
        <div class="title-block"><h1 class="title-main" style="font-size:1.6rem;">PAUSED</h1></div>
        <div style="display:flex; flex-direction:column; gap:12px;">
          <button class="hud-button" id="pause-resume-btn">RESUME</button>
          <button class="hud-button secondary" id="pause-settings-btn">SETTINGS</button>
          <button class="hud-button secondary" id="pause-restart-btn">RESTART MISSION</button>
          <button class="hud-button secondary" id="pause-title-btn">RETURN TO TITLE</button>
        </div>
      </div>
    `;
    container.appendChild(this.el);
    this.el.querySelector('#pause-resume-btn')!.addEventListener('click', handlers.onResume);
    this.el.querySelector('#pause-settings-btn')!.addEventListener('click', handlers.onSettings);
    this.el.querySelector('#pause-restart-btn')!.addEventListener('click', handlers.onRestart);
    this.el.querySelector('#pause-title-btn')!.addEventListener('click', handlers.onQuitToTitle);
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
}

export class SettingsPanel {
  el: HTMLElement;
  private onCloseCb: (() => void) | null = null;
  constructor(container: HTMLElement, private settings: Settings, private onChange: (s: Settings) => void) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.render();
    container.appendChild(this.el);
  }

  private render() {
    this.el.innerHTML = `
      <div class="crt-panel" style="width:420px;">
        <div class="title-block"><h1 class="title-main" style="font-size:1.6rem;">SETTINGS</h1></div>
        <div class="settings-grid">
          <label>Mouse Sensitivity</label>
          <input type="range" id="set-sens" min="0" max="1" step="0.05" value="${this.settings.mouseSensitivity}" />
          <label>Difficulty</label>
          <select id="set-diff">
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
          <label>Mute Audio</label>
          <input type="checkbox" id="set-mute" ${this.settings.muted ? 'checked' : ''} />
          <label>Reduce Screen Shake</label>
          <input type="checkbox" id="set-shake" ${this.settings.reducedScreenShake ? 'checked' : ''} />
          <label>Show FPS Counter</label>
          <input type="checkbox" id="set-fps" ${this.settings.showFps ? 'checked' : ''} />
        </div>
        <div class="actions-row">
          <div></div>
          <button class="hud-button" id="set-close-btn">CLOSE</button>
        </div>
      </div>
    `;
    const diffSelect = this.el.querySelector<HTMLSelectElement>('#set-diff')!;
    diffSelect.value = this.settings.difficulty;
    diffSelect.addEventListener('change', () => {
      this.settings.difficulty = diffSelect.value as Difficulty;
      this.onChange(this.settings);
    });
    this.el.querySelector<HTMLInputElement>('#set-sens')!.addEventListener('input', (e) => {
      this.settings.mouseSensitivity = parseFloat((e.target as HTMLInputElement).value);
      this.onChange(this.settings);
    });
    this.el.querySelector<HTMLInputElement>('#set-mute')!.addEventListener('change', (e) => {
      this.settings.muted = (e.target as HTMLInputElement).checked;
      this.onChange(this.settings);
    });
    this.el.querySelector<HTMLInputElement>('#set-shake')!.addEventListener('change', (e) => {
      this.settings.reducedScreenShake = (e.target as HTMLInputElement).checked;
      this.onChange(this.settings);
    });
    this.el.querySelector<HTMLInputElement>('#set-fps')!.addEventListener('change', (e) => {
      this.settings.showFps = (e.target as HTMLInputElement).checked;
      this.onChange(this.settings);
    });
    this.el.querySelector('#set-close-btn')!.addEventListener('click', () => this.onCloseCb?.());
  }

  onClose(cb: () => void) {
    this.onCloseCb = cb;
  }

  show() {
    this.el.classList.remove('hidden');
  }
  hide() {
    this.el.classList.add('hidden');
  }
}
