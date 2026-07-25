import { Difficulty } from '../game/Constants';

export interface BriefingResult {
  difficulty: Difficulty;
  skipLaunch: boolean;
}

/** The pre-mission briefing screen: original tactical text, loadout, controls, and start options. */
export class BriefingScreen {
  el: HTMLElement;
  private difficulty: Difficulty = 'normal';
  private skipLaunch = false;
  private onStart: ((result: BriefingResult) => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.el.innerHTML = this.template();
    container.appendChild(this.el);
    this.bind();
  }

  private template(): string {
    return `
      <div class="crt-panel">
        <div class="title-block">
          <h1 class="title-main">OPERATION BROKEN BEACON</h1>
          <div class="title-sub">MISSION BRIEFING &mdash; CVN RESOLUTE CARRIER AIR WING</div>
        </div>
        <div class="row">
          <div class="col briefing-text">
            <div class="section-title">SITUATION</div>
            <p>Hostile fighters designated Kestrel-9 are massing east of the task force. A coastal early-warning
            radar is vectoring them toward CVN Resolute. Fleet intelligence confirms the installation is
            purely military; nearby coastal structures are civilian and must not be engaged.</p>
            <div class="section-title">OBJECTIVES</div>
            <ul class="plain">
              <li>Launch and proceed to waypoint ALPHA</li>
              <li>Intercept and destroy two Kestrel-9 fighters</li>
              <li>Proceed to waypoint BRAVO and destroy the coastal radar site</li>
              <li>Return to CVN Resolute and land</li>
              <li>Do not engage civilian structures</li>
            </ul>
            <div class="section-title">WEATHER / DURATION</div>
            <p>Scattered clouds, light haze, sea state 2. Estimated mission duration: 10-15 minutes.</p>
          </div>
          <div class="col briefing-text">
            <div class="section-title">LOADOUT &mdash; VIPER ONE</div>
            <ul class="plain">
              <li>1x 20mm cannon, 240 rounds</li>
              <li>4x radar-guided air-to-air missiles</li>
            </ul>
            <div class="section-title">CONTROLS</div>
            <ul class="plain">
              <li>W/S pitch, A/D roll, Q/E yaw (arrow keys also work)</li>
              <li>Shift/Ctrl throttle, B afterburner</li>
              <li>Space cannon, R missile, T cycle target, L radar lock</li>
              <li>G gear, F flaps, C camera, M map, P/Esc pause</li>
            </ul>
            <div class="section-title">THREAT SUMMARY</div>
            <p>2x Kestrel-9 fighters (cannon + missiles), 1x coastal early-warning radar.</p>
          </div>
        </div>
        <div class="section-title">DIFFICULTY</div>
        <div class="diff-select">
          <button class="hud-button" data-diff="easy">EASY</button>
          <button class="hud-button active" data-diff="normal">NORMAL</button>
          <button class="hud-button" data-diff="hard">HARD</button>
        </div>
        <div class="actions-row">
          <label class="checkbox-row">
            <input type="checkbox" id="skip-launch-checkbox" />
            Skip Carrier Launch (start airborne, for rapid testing)
          </label>
          <div style="display:flex; gap:10px;">
            <button class="hud-button secondary" id="briefing-settings-btn">SETTINGS</button>
            <button class="hud-button" id="briefing-start-btn">START MISSION</button>
          </div>
        </div>
      </div>
    `;
  }

  private bind() {
    this.el.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.difficulty = btn.dataset.diff as Difficulty;
        this.el.querySelectorAll('[data-diff]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    const skipBox = this.el.querySelector<HTMLInputElement>('#skip-launch-checkbox')!;
    skipBox.addEventListener('change', () => {
      this.skipLaunch = skipBox.checked;
    });
    this.el.querySelector('#briefing-start-btn')!.addEventListener('click', () => {
      this.onStart?.({ difficulty: this.difficulty, skipLaunch: this.skipLaunch });
    });
  }

  onSettings(cb: () => void) {
    this.el.querySelector('#briefing-settings-btn')!.addEventListener('click', cb);
  }

  onStartMission(cb: (result: BriefingResult) => void) {
    this.onStart = cb;
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.el.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      b.classList.toggle('active', b.dataset.diff === d);
    });
  }

  show() {
    this.el.classList.remove('hidden');
  }
  hide() {
    this.el.classList.add('hidden');
  }
}
