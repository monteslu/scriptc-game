/* Polled input state, built by draining the event queue each frame.
 *
 * Games want polled state ("is left held?"), not callbacks, and the FFI has
 * no callbacks anyway, so the event stream feeds state maps that game code
 * reads synchronously.
 */

// event kinds, mirrored from shim/sg_core.cpp
export const EV_NONE = 0;
export const EV_QUIT = 1;
export const EV_KEYDOWN = 2;
export const EV_KEYUP = 3;
export const EV_MOUSEMOVE = 4;
export const EV_MOUSEDOWN = 5;
export const EV_MOUSEUP = 6;
export const EV_WINDOW = 7;

// event field indices, mirrored from shim/sg_core.cpp
export const F_SCANCODE = 0;
export const F_REPEAT = 1;
export const F_X = 2;
export const F_Y = 3;
export const F_BUTTON = 4;
export const F_WINEVENT = 5;

/* SDL scancodes for the keys the framework names. Kept as a small explicit
 * table rather than the full 512-entry set: game code asks for these. */
export const KEY_A = 4;
export const KEY_D = 7;
export const KEY_S = 22;
export const KEY_W = 26;
export const KEY_ESCAPE = 41;
export const KEY_SPACE = 44;
export const KEY_RIGHT = 79;
export const KEY_LEFT = 80;
export const KEY_DOWN = 81;
export const KEY_UP = 82;

const MAX_SCANCODE = 512;

export class Input {
  private down: boolean[] = [];
  private pressed: boolean[] = [];
  private released: boolean[] = [];

  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  quitRequested = false;

  constructor() {
    for (let i = 0; i < MAX_SCANCODE; i++) {
      this.down.push(false);
      this.pressed.push(false);
      this.released.push(false);
    }
  }

  /** Clears the per-frame edge state. Call before draining events. */
  beginFrame(): void {
    for (let i = 0; i < MAX_SCANCODE; i++) {
      this.pressed[i] = false;
      this.released[i] = false;
    }
  }

  handle(kind: number, scancode: number, repeat: number, x: number, y: number): void {
    if (kind === EV_QUIT) {
      this.quitRequested = true;
      return;
    }
    if (kind === EV_KEYDOWN) {
      if (scancode >= 0 && scancode < MAX_SCANCODE) {
        if (repeat === 0) this.pressed[scancode] = true;
        this.down[scancode] = true;
      }
      return;
    }
    if (kind === EV_KEYUP) {
      if (scancode >= 0 && scancode < MAX_SCANCODE) {
        this.down[scancode] = false;
        this.released[scancode] = true;
      }
      return;
    }
    if (kind === EV_MOUSEMOVE) { this.mouseX = x; this.mouseY = y; return; }
    if (kind === EV_MOUSEDOWN) { this.mouseX = x; this.mouseY = y; this.mouseDown = true; return; }
    if (kind === EV_MOUSEUP) { this.mouseX = x; this.mouseY = y; this.mouseDown = false; return; }
  }

  isDown(scancode: number): boolean {
    if (scancode < 0 || scancode >= MAX_SCANCODE) return false;
    return this.down[scancode];
  }

  wasPressed(scancode: number): boolean {
    if (scancode < 0 || scancode >= MAX_SCANCODE) return false;
    return this.pressed[scancode];
  }

  wasReleased(scancode: number): boolean {
    if (scancode < 0 || scancode >= MAX_SCANCODE) return false;
    return this.released[scancode];
  }
}
