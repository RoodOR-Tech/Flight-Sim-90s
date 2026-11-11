import { Difficulty } from '../game/Constants';
import { MISSIONS, MISSION_ORDER, MissionId } from '../game/Missions';

export interface BriefingResult {
  difficulty: Difficulty;
  skipLaunch: boolean;
  missionId: MissionId;
}

/** The pre-mission briefing screen: original tactical text, loadout, controls, and start options. */
export class BriefingScreen {
  el: HTMLElement;
  private difficulty: Difficulty = 'normal';
  private skipLaunch = false;
  private missionId: MissionId = 'broken_beacon';
  private onStart: ((result: BriefingResult) => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    this.el.innerHTML = this.template();
    container.appendChild(this.el);
    this.bind();
    this.renderMission();
  }

  private template(): string {
    return `
      <div class="crt-panel">
        <div class="title-block">
          <h1 class="title-main" id="briefing-title"></h1>
          <div class="title-sub">MISSION BRIEFING &mdash; CVN RESOLUTE CARRIER AIR WING</div>
        </div>
        <div class="section-title">MISSION</div>
        <div class="diff-select">
          ${MISSION_ORDER.map(
            (id) => `<button class="hud-button" data-mission="${id}">${MISSIONS[id].shortName}</button>`,
          ).join('')}
        </div>
        <div class="row">
          <div class="col briefing-text">
            <div class="section-title">SITUATION</div>
            <p id="briefing-situation"></p>
            <div class="section-title">OBJECTIVES</div>
            <ul class="plain" id="briefing-objectives"></ul>
            <div class="section-title">WEATHER / DURATION</div>
            <p id="briefing-weather"></p>
          </div>
          <div class="col briefing-text">
            <div class="section-title">LOADOUT &mdash; VIPER ONE</div>
            <ul class="plain" id="briefing-loadout"></ul>
            <div class="section-title">CONTROLS</div>
            <ul class="plain">
              <li>W/S pitch, A/D roll, Q/E yaw (arrow keys also work)</li>
              <li>Shift/Ctrl throttle, B afterburner</li>
              <li>Space cannon, R missile, X bomb, T cycle target, L radar lock</li>
              <li>G gear, F flaps, C camera, M map, P/Esc pause</li>
            </ul>
            <div class="section-title">THREAT SUMMARY</div>
            <p id="briefing-threat"></p>
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

  /** Fills in the mission-specific text. All of it comes from the static mission catalogue. */
  private renderMission() {
    const m = MISSIONS[this.missionId];
    const text = (id: string, value: string) => {
      this.el.querySelector(`#${id}`)!.textContent = value;
    };
    const list = (id: string, items: string[]) => {
      const ul = this.el.querySelector(`#${id}`)!;
      ul.replaceChildren(
        ...items.map((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          return li;
        }),
      );
    };
    text('briefing-title', m.name.toUpperCase());
    text('briefing-situation', m.situation);
    text('briefing-weather', m.weather);
    text('briefing-threat', m.threat);
    list('briefing-objectives', m.objectives);
    list('briefing-loadout', m.loadoutLines);
    this.el.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mission === this.missionId);
    });
  }

  private bind() {
    this.el.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.missionId = btn.dataset.mission as MissionId;
        this.renderMission();
      });
    });
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
      this.onStart?.({ difficulty: this.difficulty, skipLaunch: this.skipLaunch, missionId: this.missionId });
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
