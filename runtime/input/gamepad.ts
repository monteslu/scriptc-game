/* The Gamepad API, web-shaped.
 *
 * `gamepads()` returns Gamepad-shaped records with the STANDARD MAPPING
 * button and axis order, so code written against the web API reads the same
 * here. SDL's own controller mapping does the device-specific work, and this
 * layer only reorders it into the standard layout.
 *
 * The standard mapping (w3c.github.io/gamepad/#remapping):
 *
 *   buttons  0 A/cross      1 B/circle     2 X/square    3 Y/triangle
 *            4 L1           5 R1           6 L2          7 R2
 *            8 select/back  9 start       10 L3         11 R3
 *           12 dpad up     13 dpad down   14 dpad left  15 dpad right
 *           16 guide/home
 *   axes     0 left X       1 left Y       2 right X      3 right Y
 *
 * L2/R2 (6 and 7) are ANALOG on most pads: SDL reports them as axes, and the
 * web API reports them as buttons with a `value`, so they are read from the
 * trigger axes and exposed as pressed-when-past-half.
 */
import * as ffi from "../ffi.js";
import { readMailbox } from "../mailbox.js";

/** SDL_GameControllerButton indices. */
const SDL_BTN_A = 0;
const SDL_BTN_B = 1;
const SDL_BTN_X = 2;
const SDL_BTN_Y = 3;
const SDL_BTN_BACK = 4;
const SDL_BTN_GUIDE = 5;
const SDL_BTN_START = 6;
const SDL_BTN_LEFTSTICK = 7;
const SDL_BTN_RIGHTSTICK = 8;
const SDL_BTN_LEFTSHOULDER = 9;
const SDL_BTN_RIGHTSHOULDER = 10;
const SDL_BTN_DPAD_UP = 11;
const SDL_BTN_DPAD_DOWN = 12;
const SDL_BTN_DPAD_LEFT = 13;
const SDL_BTN_DPAD_RIGHT = 14;

/** SDL_GameControllerAxis indices. */
const SDL_AXIS_LEFTX = 0;
const SDL_AXIS_LEFTY = 1;
const SDL_AXIS_RIGHTX = 2;
const SDL_AXIS_RIGHTY = 3;
const SDL_AXIS_TRIGGERLEFT = 4;
const SDL_AXIS_TRIGGERRIGHT = 5;

/* Standard-mapping button index -> SDL button index. The two analog triggers
 * are -1 because they come from axes instead. */
const STANDARD_TO_SDL: number[] = [
  SDL_BTN_A, SDL_BTN_B, SDL_BTN_X, SDL_BTN_Y,
  SDL_BTN_LEFTSHOULDER, SDL_BTN_RIGHTSHOULDER,
  -1, -1,
  SDL_BTN_BACK, SDL_BTN_START,
  SDL_BTN_LEFTSTICK, SDL_BTN_RIGHTSTICK,
  SDL_BTN_DPAD_UP, SDL_BTN_DPAD_DOWN, SDL_BTN_DPAD_LEFT, SDL_BTN_DPAD_RIGHT,
  SDL_BTN_GUIDE,
];

export const BUTTON_COUNT = 17;
export const AXIS_COUNT = 4;

/** Standard-mapping button indices, named. */
export const BTN_A = 0;
export const BTN_B = 1;
export const BTN_X = 2;
export const BTN_Y = 3;
export const BTN_L1 = 4;
export const BTN_R1 = 5;
export const BTN_L2 = 6;
export const BTN_R2 = 7;
export const BTN_SELECT = 8;
export const BTN_START = 9;
export const BTN_L3 = 10;
export const BTN_R3 = 11;
export const BTN_DPAD_UP = 12;
export const BTN_DPAD_DOWN = 13;
export const BTN_DPAD_LEFT = 14;
export const BTN_DPAD_RIGHT = 15;
export const BTN_GUIDE = 16;

export const AXIS_LEFT_X = 0;
export const AXIS_LEFT_Y = 1;
export const AXIS_RIGHT_X = 2;
export const AXIS_RIGHT_Y = 3;

/** One button's state, as the web API reports it. */
export class GamepadButton {
  pressed = false;
  touched = false;
  value = 0;
}

export class Gamepad {
  index = 0;
  id = "";
  connected = false;
  mapping = "standard";
  axes: number[] = [];
  buttons: GamepadButton[] = [];
  /** True when the pad has motors; playEffect is a no-op otherwise. */
  hasRumble = false;

  constructor(index: number) {
    this.index = index;
    for (let i = 0; i < AXIS_COUNT; i++) this.axes.push(0);
    for (let i = 0; i < BUTTON_COUNT; i++) this.buttons.push(new GamepadButton());
  }

  /* The web's vibrationActuator.playEffect("dual-rumble", {...}). Synchronous
   * here rather than promise-returning: there is nothing to await, and the
   * effect either starts or the pad has no motors. */
  playEffect(weakMagnitude: number, strongMagnitude: number, durationMs: number): void {
    ffi.padRumble(this.index, weakMagnitude, strongMagnitude, durationMs);
  }
}

/* Pads are POOLED, not rebuilt per frame: a game that holds a reference to
 * `gamepads()[0]` across frames should see it update, and allocating 17
 * button records every frame for every pad is pure garbage. */
const MAX_PADS = 8;
const pool: Gamepad[] = [];

function ensurePool(): void {
  while (pool.length < MAX_PADS) pool.push(new Gamepad(pool.length));
}

/** Trigger axes read 0..1; the web reports them as buttons with a value. */
function triggerValue(slot: number, axis: number): number {
  const v = ffi.padAxis(slot, axis);
  return v < 0 ? 0 : v;
}

/** Refreshes every pad's state. Called once per frame by the input layer. */
export function pollGamepads(): void {
  ensurePool();
  for (let slot = 0; slot < MAX_PADS; slot++) {
    const pad = pool[slot];
    const connected = ffi.padConnected(slot) !== 0;

    if (!connected) {
      if (pad.connected) {
        // Zero a pad on disconnect so stale "held" state cannot strand a
        // character running into a wall forever.
        pad.connected = false;
        pad.id = "";
        pad.hasRumble = false;
        for (let i = 0; i < AXIS_COUNT; i++) pad.axes[i] = 0;
        for (let i = 0; i < BUTTON_COUNT; i++) {
          pad.buttons[i].pressed = false;
          pad.buttons[i].touched = false;
          pad.buttons[i].value = 0;
        }
      }
      continue;
    }

    if (!pad.connected) {
      pad.connected = true;
      ffi.padName(slot);
      pad.id = readMailbox();
      pad.hasRumble = ffi.padHasRumble(slot) !== 0;
    }

    pad.axes[AXIS_LEFT_X] = ffi.padAxis(slot, SDL_AXIS_LEFTX);
    pad.axes[AXIS_LEFT_Y] = ffi.padAxis(slot, SDL_AXIS_LEFTY);
    pad.axes[AXIS_RIGHT_X] = ffi.padAxis(slot, SDL_AXIS_RIGHTX);
    pad.axes[AXIS_RIGHT_Y] = ffi.padAxis(slot, SDL_AXIS_RIGHTY);

    for (let b = 0; b < BUTTON_COUNT; b++) {
      const sdl = STANDARD_TO_SDL[b];
      const btn = pad.buttons[b];
      if (sdl >= 0) {
        const down = ffi.padButton(slot, sdl) !== 0;
        btn.pressed = down;
        btn.touched = down;
        btn.value = down ? 1 : 0;
      }
    }

    // The two analog triggers, from axes.
    const l2 = triggerValue(slot, SDL_AXIS_TRIGGERLEFT);
    const r2 = triggerValue(slot, SDL_AXIS_TRIGGERRIGHT);
    pad.buttons[BTN_L2].value = l2;
    pad.buttons[BTN_L2].pressed = l2 > 0.5;
    pad.buttons[BTN_L2].touched = l2 > 0;
    pad.buttons[BTN_R2].value = r2;
    pad.buttons[BTN_R2].pressed = r2 > 0.5;
    pad.buttons[BTN_R2].touched = r2 > 0;
  }
}

/** Connected pads only, in slot order. Mirrors navigator.getGamepads(). */
export function gamepads(): Gamepad[] {
  ensurePool();
  const out: Gamepad[] = [];
  for (let i = 0; i < MAX_PADS; i++) {
    if (pool[i].connected) out.push(pool[i]);
  }
  return out;
}

/** A pad by slot, connected or not; null for an out-of-range slot. */
export function gamepad(slot: number): Gamepad | null {
  ensurePool();
  if (slot < 0 || slot >= MAX_PADS) return null;
  return pool[slot];
}

/** Adds an SDL controller-mapping line for an unrecognised device. */
export function addMapping(mapping: string): number {
  return ffi.padAddMapping(mapping);
}
