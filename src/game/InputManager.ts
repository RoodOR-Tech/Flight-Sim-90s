// Tracks raw keyboard/mouse state and exposes discrete "just pressed" edges for menu-style actions.
export type ActionKey =
  | 'pitchDown'
  | 'pitchUp'
  | 'rollLeft'
  | 'rollRight'
  | 'yawLeft'
  | 'yawRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'afterburner'
  | 'fireCannon'
  | 'fireMissile'
  | 'cycleTarget'
  | 'radarLock'
  | 'toggleGear'
  | 'toggleFlaps'
  | 'cycleCamera'
  | 'toggleMap'
  | 'pause'
  | 'menu'
  | 'confirm';

const KEY_MAP: Record<string, ActionKey> = {
  KeyW: 'pitchDown',
  ArrowUp: 'pitchDown',
  KeyS: 'pitchUp',
  ArrowDown: 'pitchUp',
  KeyA: 'rollLeft',
  ArrowLeft: 'rollLeft',
  KeyD: 'rollRight',
  ArrowRight: 'rollRight',
  KeyQ: 'yawLeft',
  KeyE: 'yawRight',
  ShiftLeft: 'throttleUp',
  ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown',
  ControlRight: 'throttleDown',
  KeyB: 'afterburner',
  Space: 'fireCannon',
  KeyR: 'fireMissile',
  KeyT: 'cycleTarget',
  KeyL: 'radarLock',
  KeyG: 'toggleGear',
  KeyF: 'toggleFlaps',
  KeyC: 'cycleCamera',
  KeyM: 'toggleMap',
  KeyP: 'pause',
  Escape: 'menu',
  Enter: 'confirm',
};

export class InputManager {
  private held = new Set<ActionKey>();
  private justPressed = new Set<ActionKey>();
  private enabled = true;

  public mouseDeltaX = 0;
  public mouseDeltaY = 0;
  public sensitivity = 0.5;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.held.clear();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (action) {
      if (this.preventDefaultFor(e.code)) e.preventDefault();
      if (!this.held.has(action)) this.justPressed.add(action);
      if (this.enabled || action === 'menu' || action === 'pause' || action === 'confirm') {
        this.held.add(action);
      }
    }
  };

  private preventDefaultFor(code: string): boolean {
    return [
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
    ].includes(code);
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (action) {
      this.held.delete(action);
    }
  };

  private onBlur = () => {
    this.held.clear();
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseDeltaX += e.movementX || 0;
    this.mouseDeltaY += e.movementY || 0;
  };

  isHeld(action: ActionKey): boolean {
    return this.enabled && this.held.has(action);
  }

  /** Consumes and returns whether an action transitioned to pressed this frame (works even when gameplay input disabled, for menu navigation). */
  consumeJustPressed(action: ActionKey): boolean {
    const v = this.justPressed.has(action);
    this.justPressed.delete(action);
    return v;
  }

  consumeMouseDelta(): { x: number; y: number } {
    const x = this.mouseDeltaX;
    const y = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return { x, y };
  }

  endFrame() {
    this.justPressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousemove', this.onMouseMove);
  }
}
