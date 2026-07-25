import { ScoreResult } from '../systems/ScoringSystem';

export interface ResultsData {
  success: boolean;
  failReason?: string;
  score: ScoreResult;
  objectives: { label: string; complete: boolean }[];
  accuracy: number;
  completionTimeSeconds: number;
  landedSuccessfully: boolean;
  sessionBest: number | null;
}

export class ResultsScreen {
  el: HTMLElement;
  private onRestartCb: (() => void) | null = null;
  private onBriefingCb: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden interactive';
    container.appendChild(this.el);
  }

  show(data: ResultsData) {
    const timeStr = `${Math.floor(data.completionTimeSeconds / 60)}:${String(Math.floor(data.completionTimeSeconds % 60)).padStart(2, '0')}`;
    this.el.innerHTML = `
      <div class="crt-panel">
        <div class="title-block">
          <h1 class="title-main">${data.success ? 'MISSION SUCCESS' : 'MISSION FAILED'}</h1>
          <div class="title-sub">${data.success ? 'OPERATION BROKEN BEACON COMPLETE' : (data.failReason ?? '')}</div>
        </div>
        <div class="grade">${data.score.grade}</div>
        <div class="row">
          <div class="col">
            <div class="section-title">OBJECTIVES</div>
            <ul class="plain">
              ${data.objectives.map((o) => `<li>${o.complete ? '[X]' : '[ ]'} ${o.label}</li>`).join('')}
            </ul>
          </div>
          <div class="col">
            <div class="section-title">SCORE BREAKDOWN</div>
            <table class="results-table">
              <tr><td>Enemies destroyed</td><td>${data.score.breakdown.enemies}</td></tr>
              <tr><td>Radar destroyed</td><td>${data.score.breakdown.radar}</td></tr>
              <tr><td>Cannon accuracy (${Math.round(data.accuracy * 100)}%)</td><td>${Math.round(data.score.breakdown.accuracy)}</td></tr>
              <tr><td>Missiles remaining</td><td>${data.score.breakdown.missiles}</td></tr>
              <tr><td>Aircraft health</td><td>${Math.round(data.score.breakdown.health)}</td></tr>
              <tr><td>Carrier landing</td><td>${data.score.breakdown.landing}</td></tr>
              <tr><td>Time bonus (${timeStr})</td><td>${Math.round(data.score.breakdown.timeBonus)}</td></tr>
              <tr><td>Civilian penalty</td><td>-${data.score.breakdown.civilianPenalty}</td></tr>
              <tr><td><strong>TOTAL</strong></td><td><strong>${data.score.score}</strong></td></tr>
            </table>
            ${data.sessionBest !== null ? `<p style="margin-top:8px;">Session best: ${data.sessionBest}</p>` : ''}
          </div>
        </div>
        <div class="actions-row">
          <button class="hud-button secondary" id="results-briefing-btn">RETURN TO BRIEFING</button>
          <button class="hud-button" id="results-restart-btn">RESTART MISSION</button>
        </div>
      </div>
    `;
    this.el.querySelector('#results-restart-btn')!.addEventListener('click', () => this.onRestartCb?.());
    this.el.querySelector('#results-briefing-btn')!.addEventListener('click', () => this.onBriefingCb?.());
    this.el.classList.remove('hidden');
  }

  onRestart(cb: () => void) {
    this.onRestartCb = cb;
  }
  onReturnToBriefing(cb: () => void) {
    this.onBriefingCb = cb;
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
