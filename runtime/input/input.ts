/* Polled input state, built by draining the event queue each frame.
 *
 * Games want polled state ("is left held?"), not callbacks, and the FFI has
 * no callbacks anyway, so the event stream feeds state that game code reads
 * synchronously. Keys are named the way the web names them
 * (`isDown("ArrowLeft")`), never by scancode.
 *
 * Text input is the exception that proves the rule: it is inherently a
 * SEQUENCE, so it drains as a queue rather than collapsing into state.
 */
import * as ffi from "../ffi.js";
import { readTextEvent } from "../mailbox.js";
import { scancodeOf, SCANCODE_TO_CODE } from "./keycodes.js";
import { pollGamepads, gamepads, connectedGamepads, gamepad, Gamepad } from "./gamepad.js";
import {
  EV_NONE, EV_QUIT, EV_KEYDOWN, EV_KEYUP, EV_MOUSEMOVE, EV_MOUSEDOWN,
  EV_MOUSEUP, EV_MOUSEWHEEL, EV_TEXT, EV_WINDOW, EV_PADADDED, EV_PADREMOVED,
  F_SCANCODE, F_REPEAT, F_X, F_Y, F_BUTTON, F_WINEVENT, F_MODS,
  F_WHEEL_X, F_WHEEL_Y,
  WIN_FOCUS_GAINED, WIN_FOCUS_LOST, WIN_CLOSE, WIN_RESIZED, WIN_SIZE_CHANGED,
  MOUSE_LEFT,
} from "./events.js";

const MAX_SCANCODE = 512;
const MAX_MOUSE_BUTTON = 8;

export class Input {
  private down: boolean[] = [];
  private pressed: boolean[] = [];
  private released: boolean[] = [];

  private mouseButtons: boolean[] = [];
  private mousePressed: boolean[] = [];
  private mouseReleased: boolean[] = [];

  mouseX = 0;
  mouseY = 0;
  /** Wheel movement THIS FRAME; positive y is away from the user. */
  wheelX = 0;
  wheelY = 0;
  /** SDL_Keymod bitmask as of the last key event. */
  mods = 0;

  quitRequested = false;
  focused = true;
  /** Set when the window was resized this frame; the payload is below. */
  resized = false;
  resizeW = 0;
  resizeH = 0;

  /** Text typed this frame, in order. Empty unless textInput is enabled. */
  private textQueue: string[] = [];

  constructor() {
    for (let i = 0; i < MAX_SCANCODE; i++) {
      this.down.push(false);
      this.pressed.push(false);
      this.released.push(false);
    }
    for (let i = 0; i < MAX_MOUSE_BUTTON; i++) {
      this.mouseButtons.push(false);
      this.mousePressed.push(false);
      this.mouseReleased.push(false);
    }
  }

  /** Clears per-frame edge state. Call before draining events. */
  beginFrame(): void {
    for (let i = 0; i < MAX_SCANCODE; i++) {
      this.pressed[i] = false;
      this.released[i] = false;
    }
    for (let i = 0; i < MAX_MOUSE_BUTTON; i++) {
      this.mousePressed[i] = false;
      this.mouseReleased[i] = false;
    }
    this.wheelX = 0;
    this.wheelY = 0;
    this.resized = false;
    if (this.textQueue.length > 0) this.textQueue = [];
  }

  /** Drains the whole event queue into state. One call per frame. */
  pump(): void {
    this.beginFrame();
    let kind = ffi.pollEvent();
    while (kind !== EV_NONE) {
      this.handle(kind);
      kind = ffi.pollEvent();
    }
    // Controller state is polled, not evented: SDL's standard-mapping
    // accessors give current values, which is exactly what a frame wants.
    pollGamepads();
  }

  private handle(kind: number): void {
    if (kind === EV_QUIT) {
      this.quitRequested = true;
      return;
    }
    if (kind === EV_KEYDOWN || kind === EV_KEYUP) {
      const sc = ffi.evtI32(F_SCANCODE);
      this.mods = ffi.evtI32(F_MODS);
      if (sc < 0 || sc >= MAX_SCANCODE) return;
      if (kind === EV_KEYDOWN) {
        // A key REPEAT is not a fresh press; wasPressed must stay an edge.
        if (ffi.evtI32(F_REPEAT) === 0) this.pressed[sc] = true;
        this.down[sc] = true;
      } else {
        this.down[sc] = false;
        this.released[sc] = true;
      }
      return;
    }
    if (kind === EV_MOUSEMOVE) {
      this.mouseX = ffi.evtI32(F_X);
      this.mouseY = ffi.evtI32(F_Y);
      return;
    }
    if (kind === EV_MOUSEDOWN || kind === EV_MOUSEUP) {
      this.mouseX = ffi.evtI32(F_X);
      this.mouseY = ffi.evtI32(F_Y);
      const b = ffi.evtI32(F_BUTTON);
      if (b < 0 || b >= MAX_MOUSE_BUTTON) return;
      if (kind === EV_MOUSEDOWN) {
        this.mouseButtons[b] = true;
        this.mousePressed[b] = true;
      } else {
        this.mouseButtons[b] = false;
        this.mouseReleased[b] = true;
      }
      return;
    }
    if (kind === EV_MOUSEWHEEL) {
      this.wheelX += ffi.evtI32(F_WHEEL_X);
      this.wheelY += ffi.evtI32(F_WHEEL_Y);
      return;
    }
    if (kind === EV_TEXT) {
      // Drained NOW: the shim's text buffer is overwritten by the next event.
      this.textQueue.push(readTextEvent());
      return;
    }
    if (kind === EV_WINDOW) {
      const we = ffi.evtI32(F_WINEVENT);
      if (we === WIN_FOCUS_GAINED) {
        this.focused = true;
        return;
      }
      if (we === WIN_FOCUS_LOST) {
        this.focused = false;
        // Losing focus swallows the matching key-up, so drop everything held:
        // otherwise alt-tabbing mid-move leaves the key stuck down forever.
        this.releaseAll();
        return;
      }
      if (we === WIN_CLOSE) { this.quitRequested = true; return; }
      if (we === WIN_RESIZED || we === WIN_SIZE_CHANGED) {
        this.resized = true;
        this.resizeW = ffi.evtI32(F_X);
        this.resizeH = ffi.evtI32(F_Y);
        return;
      }
      return;
    }
    if (kind === EV_PADADDED || kind === EV_PADREMOVED) {
      // The slot array is maintained shim-side; pollGamepads() picks the
      // change up this same frame, so there is nothing to do here beyond
      // not treating the event as unknown.
      return;
    }
  }

  /** Clears all held state, as on focus loss. Release edges still fire. */
  private releaseAll(): void {
    for (let i = 0; i < MAX_SCANCODE; i++) {
      if (this.down[i]) { this.down[i] = false; this.released[i] = true; }
    }
    for (let i = 0; i < MAX_MOUSE_BUTTON; i++) {
      if (this.mouseButtons[i]) {
        this.mouseButtons[i] = false;
        this.mouseReleased[i] = true;
      }
    }
  }

  /* ---- keyboard, by W3C code name ---- */

  isDown(code: string): boolean {
    const sc = scancodeOf(code);
    return sc < 0 ? false : this.down[sc];
  }

  wasPressed(code: string): boolean {
    const sc = scancodeOf(code);
    return sc < 0 ? false : this.pressed[sc];
  }

  wasReleased(code: string): boolean {
    const sc = scancodeOf(code);
    return sc < 0 ? false : this.released[sc];
  }

  /** Every key currently held, as W3C code names. For debug displays. */
  heldKeys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < MAX_SCANCODE; i++) {
      if (!this.down[i]) continue;
      const name = SCANCODE_TO_CODE.get(i);
      if (name !== undefined) out.push(name);
    }
    return out;
  }

  /* ---- mouse ---- */

  mouseIsDown(button: number): boolean {
    return button >= 0 && button < MAX_MOUSE_BUTTON ? this.mouseButtons[button] : false;
  }
  mouseWasPressed(button: number): boolean {
    return button >= 0 && button < MAX_MOUSE_BUTTON ? this.mousePressed[button] : false;
  }
  mouseWasReleased(button: number): boolean {
    return button >= 0 && button < MAX_MOUSE_BUTTON ? this.mouseReleased[button] : false;
  }
  /** Left button, the common case. */
  get mouseDown(): boolean { return this.mouseButtons[MOUSE_LEFT]; }

  /* ---- text ---- */

  /** Enables/disables text events (and any platform IME). Off by default. */
  textInput(enable: boolean): void { ffi.textInput(enable ? 1 : 0); }

  /** Text typed this frame, in order. */
  textEvents(): string[] { return this.textQueue; }

  /* ---- gamepads ---- */

  /** Slot-indexed, with nulls for empty slots, like navigator.getGamepads(). */
  gamepads(): (Gamepad | null)[] { return gamepads(); }
  /** Connected pads only, compacted. The convenient shape for iteration. */
  connectedGamepads(): Gamepad[] { return connectedGamepads(); }
  gamepad(slot: number): Gamepad | null { return gamepad(slot); }
}
