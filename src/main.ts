import { Game } from './game/Game';

const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

new Game(canvas, uiRoot);

// Prevent default browser behavior (page scroll, find-in-page, etc.) for gameplay keys.
window.addEventListener(
  'keydown',
  (e) => {
    if (
      [
        'Space',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'Tab',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
  },
  { passive: false },
);
