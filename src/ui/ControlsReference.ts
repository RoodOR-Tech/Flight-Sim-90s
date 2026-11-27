import { ActionKey, KEY_MAP } from '../game/InputManager';

const groups: [string, [ActionKey, string][]][] = [
  ['Flight', [
    ['pitchDown', 'Nose down'], ['pitchUp', 'Nose up'],
    ['rollLeft', 'Roll left'], ['rollRight', 'Roll right'],
    ['yawLeft', 'Yaw left'], ['yawRight', 'Yaw right'],
    ['throttleUp', 'Increase throttle'], ['throttleDown', 'Decrease throttle'],
    ['afterburner', 'Hold for afterburner'],
  ]],
  ['Radar and weapons', [
    ['cycleTarget', 'Cycle radar contact'], ['radarLock', 'Hold for manual lock'],
    ['fireMissile', 'Fire locked missile'], ['fireCannon', 'Hold to fire cannon'],
    ['dropBomb', 'Release bomb (Iron Anvil)'],
  ]],
  ['Aircraft and displays', [
    ['toggleGear', 'Raise / lower landing gear'], ['toggleFlaps', 'Raise / lower flaps'],
    ['cycleCamera', 'Cycle camera'], ['toggleMap', 'Open / close tactical map'],
    ['pause', 'Pause / resume'], ['menu', 'Pause / resume or close reference'],
    ['confirm', 'Activate focused button'],
  ]],
];

function keycaps(action: ActionKey) {
  const names: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Escape: 'Esc',
  };
  const keys = Object.entries(KEY_MAP).filter(([, value]) => value === action)
    .map(([code]) => names[code] ?? code.replace(/^Key/, ''));
  return [...new Set(keys)].map((key) => `<kbd>${key}</kbd>`).join(' ');
}

export class ControlsReference {
  private dialog = document.createElement('dialog');

  constructor(container: HTMLElement, private resetInput: () => void) {
    this.dialog.className = 'controls-reference interactive';
    this.dialog.setAttribute('aria-labelledby', 'controls-title');
    this.dialog.innerHTML = `
      <header>
        <h1 id="controls-title" tabindex="-1" autofocus>Keyboard controls</h1>
        <button class="hud-button secondary" type="button">Close</button>
      </header>
      <div class="controls-groups">
        ${groups.map(([title, rows]) => `<section><h2>${title}</h2><dl>
          ${rows.map(([action, label]) => `<div><dt>${keycaps(action)}</dt><dd>${label}</dd></div>`).join('')}
        </dl></section>`).join('')}
      </div>
      <footer><kbd>F1</kbd> Open / close reference <span>Mouse movement looks around in chase and cockpit views.</span></footer>
    `;
    container.append(this.dialog);
    this.dialog.querySelector('button')!.addEventListener('click', () => this.dialog.close());
    // Let native scrolling, focus navigation and button activation work inside the modal.
    this.dialog.addEventListener('keydown', (event) => {
      if (this.open) event.stopPropagation();
    });
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'F1' && !(this.open && event.code === 'Escape')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (this.open) this.dialog.close();
      else this.show();
    }, true);
  }

  get open() {
    return this.dialog.open;
  }

  show() {
    if (this.open) return;
    this.resetInput();
    this.dialog.showModal();
    this.dialog.scrollTop = 0;
  }
}
