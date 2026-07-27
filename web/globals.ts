/* The browser globals, as a module.
 *
 * A game imports what it needs from here and then reads as browser code:
 *
 *     import { document, requestAnimationFrame } from "scriptc-game/web";
 *
 *     const canvas = document.getElementById("game-canvas");
 *     const ctx = canvas.getContext("2d");
 *     requestAnimationFrame(frame);
 *
 * IN A BROWSER that import is satisfied by an import-map entry or a bundler
 * alias pointing at a module that re-exports the real globals:
 *
 *     export const document = globalThis.document;
 *     export const requestAnimationFrame = globalThis.requestAnimationFrame;
 *
 * ...so the same source compiles native and runs in a page. Every source file
 * that needs a global imports it, exactly like a page including a script.
 *
 * WHY NOT ACTUAL GLOBALS: scriptc is a static AOT compiler with no dynamic
 * global table. `globalThis.document = x` is refused (SC1090, "assignment to
 * non-variables"), a bound `const` does not cross a module boundary (SC0001),
 * and an ambient `declare` has no backing value. The compiler already
 * canonicalizes `globalThis.process` for its OWN stdlib globals, gated on
 * symbol provenance -- extending that to project-supplied globals is an
 * upstream change tracked on a scriptc feature branch. When it lands, this
 * module keeps working and the import line becomes optional.
 *
 * THE ASYNC RULE: anything async-SHAPED here settles on a later turn, even
 * when the underlying work already finished. Real code assumes it -- setting
 * `img.src` then attaching `onload` on the next line, wiring `.then` after
 * kicking off a load -- and a shim that resolves synchronously breaks it in
 * ways that look like heisenbugs. Genuinely synchronous web APIs
 * (`ctx.fillRect`, `localStorage.getItem`) stay synchronous.
 */
import * as ffi from "../host/ffi.js";
import { Context2D } from "./canvas/context.js";
import { Image } from "./canvas/image.js";
import { Input } from "./input/input.js";
import { Gamepad, gamepads as sparseGamepads } from "./input/gamepad.js";
import { SgMath } from "./math.js";
import { resolveUrl, readBinary, fileExists, isExternalUrl, warnAsset } from "../host/resources.js";
import { queueTask } from "../host/tasks.js";

/* ---- the task queue ----
 *
 * Defined in host/tasks.ts so web modules that need to defer (audio decode,
 * image load) can import it without importing this file -- globals imports
 * THEM, and a cycle is a hard compiler error (SC1016). */
export { queueTask, drainTasks as __drainTasks, hasTasks as __hasTasks } from "../host/tasks.js";

/* ---- requestAnimationFrame ----
 *
 * A QUEUE, not a single slot. jsgamelauncher keeps one pending callback and
 * silently drops a second registration in the same frame; a browser runs
 * both, and code that composes two independent systems depends on that.
 */
type FrameCallback = (time: number) => void;

class FrameRequest {
  id = 0;
  cb: FrameCallback;
  cancelled = false;
  constructor(id: number, cb: FrameCallback) { this.id = id; this.cb = cb; }
}

let frameRequests: FrameRequest[] = [];
let nextFrameId = 1;

export function requestAnimationFrame(cb: FrameCallback): number {
  const id = nextFrameId;
  nextFrameId += 1;
  frameRequests.push(new FrameRequest(id, cb));
  return id;
}

export function cancelAnimationFrame(id: number): void {
  for (let i = 0; i < frameRequests.length; i++) {
    if (frameRequests[i].id === id) frameRequests[i].cancelled = true;
  }
}

/** Runs the callbacks registered for THIS frame. Host-only. */
export function __runFrameCallbacks(time: number): void {
  // Snapshot first: a callback re-registering (every game loop does) must
  // land on the NEXT frame, not extend this one into an infinite loop.
  const batch = frameRequests;
  frameRequests = [];
  for (let i = 0; i < batch.length; i++) {
    if (!batch[i].cancelled) batch[i].cb(time);
  }
}

export function __hasFrameCallbacks(): boolean { return frameRequests.length > 0; }

/* ---- performance ---- */

export class Performance {
  /** Milliseconds since startup, as a double. */
  now(): number { return ffi.ticks(); }
}

export const performance = new Performance();

/* ---- canvas ----
 *
 * There is ONE canvas, backed by the window's surface, and
 * `getElementById` returns it whatever id is asked for -- the same shortcut
 * jsgamelauncher takes, because there is no DOM to query. A game that asks
 * for "game-canvas" and one that asks for "screen" both get the display.
 */
export class HTMLCanvasElement {
  private ctx: Context2D | null = null;
  /** Surface handle; 0 is the screen. */
  private surface = 0;
  private canvasHandle = 0;
  private w = 0;
  private h = 0;

  constructor(canvasHandle: number, surface: number, w: number, h: number) {
    this.canvasHandle = canvasHandle;
    this.surface = surface;
    this.w = w;
    this.h = h;
  }

  get width(): number { return this.w; }
  get height(): number { return this.h; }

  /** "2d" is the only context this build provides; WebGL is a later phase. */
  getContext(kind: string): Context2D | null {
    if (kind !== "2d") return null;
    if (this.ctx === null) this.ctx = new Context2D(this.canvasHandle, this.surface);
    return this.ctx;
  }

  /** Style is accepted and ignored, as in a launcher with no CSS. */
  style = new CanvasStyle();

  /* Element.requestFullscreen(): Promise<void>.
   *
   * Only the screen canvas can go fullscreen; an offscreen surface has no
   * window, so the promise rejects as the spec says it should for an element
   * that cannot be presented. Resolution is deferred like every other async
   * shim here. */
  requestFullscreen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.surface !== 0) {
        queueTask(() => { reject(new Error("only the screen canvas can be fullscreened")); });
        return;
      }
      const rc = ffi.setFullscreen(1);
      queueTask(() => {
        if (rc === 0) { __setFullscreenElement(this); resolve(); }
        else reject(new Error("fullscreen request failed"));
      });
    });
  }
}

export class CanvasStyle {
  width = "";
  height = "";
  display = "";
  position = "";
  cursor = "";
}

/* ---- document ---- */

export class DocumentBody {
  appendChild(child: HTMLCanvasElement): HTMLCanvasElement { return child; }
}

export class SgDocument {
  private canvas: HTMLCanvasElement;
  body = new DocumentBody();
  readyState = "complete";

  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

  /** Returns THE canvas regardless of id: there is no DOM to search. */
  getElementById(id: string): HTMLCanvasElement { return this.canvas; }
  querySelector(selector: string): HTMLCanvasElement { return this.canvas; }

  /** Only "canvas" makes sense; anything else has no backing object. */
  createElement(name: string): HTMLCanvasElement | null {
    if (name !== "canvas") return null;
    return createOffscreenCanvas(300, 150);   // the browser's default size
  }

  set title(value: string) { /* window title: not wired yet */ }

  addEventListener(type: string, listener: (e: KeyboardEvent) => void): void {
    addEventListener(type, listener);
  }
}

/* ---- keyboard events ----
 *
 * Polled state underneath, delivered as listener callbacks so game code that
 * uses `addEventListener("keydown", ...)` works. `code` is the W3C name
 * (keycodes.ts maps SDL scancodes, which are the same USB HID basis).
 */
export class KeyboardEvent {
  type = "";
  code = "";
  key = "";
  repeat = false;
  altKey = false;
  ctrlKey = false;
  shiftKey = false;
  metaKey = false;
  /** No default action exists to prevent; present so handlers can call it. */
  preventDefault(): void {}
  stopPropagation(): void {}
}

let keyDownListeners: ((e: KeyboardEvent) => void)[] = [];
let keyUpListeners: ((e: KeyboardEvent) => void)[] = [];

export function addEventListener(type: string, listener: (e: KeyboardEvent) => void): void {
  if (type === "keydown") keyDownListeners.push(listener);
  else if (type === "keyup") keyUpListeners.push(listener);
}

/** `window.addEventListener("load", fn)` -- the no-argument event shape. */
export function addEventListenerNoArg(type: string, listener: () => void): void {
  if (type === "load" || type === "DOMContentLoaded") addLoadListener(listener);
  else if (type === "fullscreenchange") fullscreenListeners.push(listener);
}

export function removeEventListener(type: string, listener: (e: KeyboardEvent) => void): void {
  // Identity comparison on function values is not available in the dialect,
  // so removal clears the whole list for that type. Documented rather than
  // silently wrong: games that need finer control should gate inside the
  // handler.
  if (type === "keydown") keyDownListeners = [];
  else if (type === "keyup") keyUpListeners = [];
}

/** Host-only: turns this frame's key edges into listener callbacks. */
export function __dispatchKeyEvents(input: Input): void {
  if (keyDownListeners.length === 0 && keyUpListeners.length === 0) return;
  const pressed = input.pressedKeys();
  for (let i = 0; i < pressed.length; i++) {
    const e = new KeyboardEvent();
    e.type = "keydown";
    e.code = pressed[i];
    e.key = pressed[i];
    for (let j = 0; j < keyDownListeners.length; j++) keyDownListeners[j](e);
  }
  const released = input.releasedKeys();
  for (let i = 0; i < released.length; i++) {
    const e = new KeyboardEvent();
    e.type = "keyup";
    e.code = released[i];
    e.key = released[i];
    for (let j = 0; j < keyUpListeners.length; j++) keyUpListeners[j](e);
  }
}

/* ---- mouse events ----
 *
 * `button` follows the WEB numbering (0 left, 1 middle, 2 right), not SDL's
 * 1-based scheme, so handlers written for a page compare correctly.
 */
export class MouseEvent {
  type = "";
  clientX = 0;
  clientY = 0;
  offsetX = 0;
  offsetY = 0;
  button = 0;
  buttons = 0;
  preventDefault(): void {}
  stopPropagation(): void {}
}

let mouseMoveListeners: ((e: MouseEvent) => void)[] = [];
let mouseDownListeners: ((e: MouseEvent) => void)[] = [];
let mouseUpListeners: ((e: MouseEvent) => void)[] = [];

export function addMouseListener(type: string, listener: (e: MouseEvent) => void): void {
  if (type === "mousemove") mouseMoveListeners.push(listener);
  else if (type === "mousedown") mouseDownListeners.push(listener);
  else if (type === "mouseup") mouseUpListeners.push(listener);
}

/** Host-only: turns this frame's mouse state into listener callbacks. */
export function __dispatchMouseEvents(input: Input, lastX: number, lastY: number): void {
  if (input.mouseX !== lastX || input.mouseY !== lastY) {
    for (let i = 0; i < mouseMoveListeners.length; i++) {
      const e = new MouseEvent();
      e.type = "mousemove";
      e.clientX = input.mouseX; e.offsetX = input.mouseX;
      e.clientY = input.mouseY; e.offsetY = input.mouseY;
      mouseMoveListeners[i](e);
    }
  }
  /* SDL numbers buttons from 1; the web numbers from 0. Translate here so a
   * handler comparing `e.button === 0` for "left" is correct. */
  for (let sdlBtn = 1; sdlBtn <= 3; sdlBtn++) {
    if (input.mouseWasPressed(sdlBtn)) {
      for (let i = 0; i < mouseDownListeners.length; i++) {
        const e = new MouseEvent();
        e.type = "mousedown";
        e.button = sdlBtn === 1 ? 0 : (sdlBtn === 2 ? 1 : 2);
        e.clientX = input.mouseX; e.offsetX = input.mouseX;
        e.clientY = input.mouseY; e.offsetY = input.mouseY;
        mouseDownListeners[i](e);
      }
    }
    if (input.mouseWasReleased(sdlBtn)) {
      for (let i = 0; i < mouseUpListeners.length; i++) {
        const e = new MouseEvent();
        e.type = "mouseup";
        e.button = sdlBtn === 1 ? 0 : (sdlBtn === 2 ? 1 : 2);
        e.clientX = input.mouseX; e.offsetX = input.mouseX;
        e.clientY = input.mouseY; e.offsetY = input.mouseY;
        mouseUpListeners[i](e);
      }
    }
  }
}

/* ---- navigator ---- */

export class SgNavigator {
  /** Slot-indexed with nulls for gaps, like the real getGamepads(). */
  getGamepads(): (Gamepad | null)[] { return sparseGamepads(); }
  userAgent = "scriptc-game";
}

export const navigator = new SgNavigator();

/* ---- Image ----
 *
 * Defined in web/canvas/image.ts (Context2D needs the type, and importing it
 * from here would be circular) and re-exported so a game gets it from the
 * same place as every other global.
 */
export { Image };

/* ---- fetch ----
 *
 * Enough of the Response surface for asset loading: arrayBuffer, text, json.
 * Local paths resolve against the game directory; absolute URLs are not
 * fetched (there is no network stack here) and report ok=false rather than
 * pretending.
 */
export class Response {
  ok = false;
  status = 404;
  statusText = "Not Found";
  url = "";
  private body: Buffer | null = null;

  constructor(url: string, body: Buffer | null) {
    this.url = url;
    this.body = body;
    if (body !== null) {
      this.ok = true;
      this.status = 200;
      this.statusText = "OK";
    }
  }

  /** An external URL this build cannot reach: not a 404, a network failure. */
  static networkError(url: string): Response {
    const r = new Response(url, null);
    r.status = 0;
    r.statusText = "network requests are not supported in this build";
    return r;
  }

  arrayBuffer(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      queueTask(() => {
        if (this.body !== null) resolve(this.body);
        else reject(new Error(`fetch failed: ${this.url}`));
      });
    });
  }

  text(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      queueTask(() => {
        if (this.body === null) { reject(new Error(`fetch failed: ${this.url}`)); return; }
        let s = "";
        for (let i = 0; i < this.body.length; i++) s += String.fromCharCode(this.body[i]);
        resolve(s);
      });
    });
  }
}

/* fetch(url): local paths read from the web root, real URLs are real fetches.
 *
 * jsgamelauncher draws the same line (fetch.js): anything starting with a
 * scheme -- http://, https://, //, data:, blob: -- is NOT a file under the
 * game directory, and everything else is. That is what lets one codebase
 * load "images/player.png" from disk natively and over HTTP in a page
 * without changing a line.
 *
 * This build has no network stack, so an external URL resolves to a Response
 * with ok=false and a status that says so, rather than silently reading a
 * nonexistent file named "https:/example.com/...". When a network stack
 * lands, only this branch changes. */
export function fetch(url: string): Promise<Response> {
  return new Promise<Response>((resolve) => {
    if (isExternalUrl(url)) {
      warnAsset("fetch", url, "this build has no network stack");
      queueTask(() => { resolve(Response.networkError(url)); });
      return;
    }
    const path = resolveUrl(url);
    const bytes = readBinary(path);
    if (bytes === null) warnAsset("fetch", url, `not found at ${path}`);
    // Resolves on a later turn even though the read already happened.
    queueTask(() => { resolve(new Response(url, bytes)); });
  });
}

/* ---- audio ----
 *
 * `new AudioContext()` as the spec spells it. The underlying device is a
 * process-wide singleton (one SDL device, one graph), so a second
 * construction returns the same context rather than failing -- which is also
 * what a browser effectively gives a game that only ever makes one.
 */
import {
  AudioContext as SgAudioContext, AudioBuffer, createAudioContext,
} from "./audio/context.js";

let audioInstance: SgAudioContext | null = null;

/* The Web Audio interfaces are ALL window globals -- verified against
 * lib.dom.d.ts, which is generated from the IDL: AudioContext,
 * OfflineAudioContext, AudioNode, AudioParam, AudioBuffer and every node
 * type have a `declare var`. Node types are also constructible in the modern
 * spec (`new GainNode(ctx, options)`) alongside the older ctx.createGain()
 * factories, so both spellings must work here. */
export {
  AudioContext, AudioNode, AudioParam, AudioBuffer,
  AudioScheduledSourceNode, AudioBufferSourceNode,
  GainNode, OscillatorNode, BiquadFilterNode, DelayNode,
  StereoPannerNode, PannerNode, DynamicsCompressorNode, WaveShaperNode,
  AnalyserNode, ConvolverNode, ChannelMergerNode, ChannelSplitterNode,
  ConstantSourceNode, IIRFilterNode,
} from "./audio/context.js";

/** The Web Audio entry point. Returns null only if no device could open. */
export function AudioContextOrNull(): SgAudioContext | null {
  if (audioInstance === null) {
    // 1024 frames is ~21ms at 48kHz: low enough to feel immediate, high
    // enough that a frame spike cannot starve the mixer.
    audioInstance = createAudioContext(48000, 1024);
  }
  return audioInstance;
}

/* ---- fonts ----
 *
 * The CSS Font Loading API: `new FontFace(family, "url(path.ttf)")`, then
 * `.load()`, then `document.fonts.add(face)`. Skia needs the file registered
 * before any text draws, which load() does; `add` is then a no-op that keeps
 * browser code valid.
 */
export class FontFace {
  family = "";
  private url = "";
  status = "unloaded";

  constructor(family: string, source: string) {
    this.family = family;
    // Accept both the CSS `url(...)` form and a bare path.
    const m = source.indexOf("url(");
    if (m >= 0) {
      const close = source.indexOf(")", m);
      let inner = source.substring(m + 4, close).trim();
      if (inner.startsWith("\"") || inner.startsWith("'")) {
        inner = inner.substring(1, inner.length - 1);
      }
      this.url = inner;
    } else {
      this.url = source;
    }
  }

  load(): Promise<FontFace> {
    return new Promise<FontFace>((resolve, reject) => {
      const path = resolveUrl(this.url);
      const rc = ffi.fontRegister(path);
      if (rc !== 0) warnAsset("font", this.url, `not found or unreadable at ${path}`);
      queueTask(() => {
        if (rc === 0) { this.status = "loaded"; resolve(this); }
        else { this.status = "error"; reject(new Error(`could not load font ${this.url}`)); }
      });
    });
  }
}

export class FontFaceSet {
  /** Registration already happened in load(); this keeps browser code valid. */
  add(face: FontFace): FontFaceSet { return this; }
}

export const fonts = new FontFaceSet();

/* ---- offscreen canvas ---- */

export function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement | null {
  const surface = ffi.surfaceCreate(w, h);
  if (surface === 0) return null;
  return new HTMLCanvasElement(__surfaceCanvas(surface), surface, w, h);
}

/** Host-only: the canvas handle for a surface. */
export function __surfaceCanvas(surface: number): number {
  return __skSurfaceGetCanvas(surface);
}

/* Imported lazily to keep the skia FFI out of the game-facing surface. */
import { surfaceGetCanvas as __skSurfaceGetCanvas } from "../host/skia-ffi.js";

/* ---- the screen ----
 *
 * Created by the host at startup and handed to `document`. A game never
 * constructs this.
 */
let screenCanvas: HTMLCanvasElement | null = null;
let documentInstance: SgDocument | null = null;
let fullscreenEl: HTMLCanvasElement | null = null;

/** Tracks document.fullscreenElement and fires `fullscreenchange`. */
export function __setFullscreenElement(el: HTMLCanvasElement | null): void {
  const changed = fullscreenEl !== el;
  fullscreenEl = el;
  if (!changed) return;
  for (let i = 0; i < fullscreenListeners.length; i++) fullscreenListeners[i]();
}

let fullscreenListeners: (() => void)[] = [];

/* The canvas the game will draw into.
 *
 * ES module imports are HOISTED: a generated entry cannot open the window
 * "before" importing the game, because the game's module body always runs
 * first. So the screen is built on first touch of `document`, and the host
 * guarantees ffi.init() has happened by then -- see host/runtime.ts, which
 * calls __initScreen() from boot() before the loop and treats a game that
 * touched document during module evaluation as already-initialised. */

/** Builds the screen canvas + document. Idempotent; safe to call early. */
export function __initScreen(): void {
  if (documentInstance !== null) return;
  const handle = ffi.screenCanvas();
  screenCanvas = new HTMLCanvasElement(handle, 0, ffi.screenWidth(), ffi.screenHeight());
  documentInstance = new SgDocument(screenCanvas);
}

/* `document` is a proxy so it can be imported before the host has opened a
 * window. In a browser the DOM exists before any script runs; here the
 * import graph is evaluated first, so the screen is built ON FIRST ACCESS
 * rather than at a fixed point. A game's top-level `getElementById` then
 * works exactly as it does in a page. */
function doc(): SgDocument {
  if (documentInstance === null) __initScreen();
  return documentInstance!;
}

class DocumentProxy {
  getElementById(id: string): HTMLCanvasElement {
    return doc().getElementById(id);
  }
  querySelector(selector: string): HTMLCanvasElement {
    return doc().querySelector(selector);
  }
  createElement(name: string): HTMLCanvasElement | null {
    return doc().createElement(name);
  }
  addEventListener(type: string, listener: (e: KeyboardEvent) => void): void {
    addEventListener(type, listener);
  }
  get body(): DocumentBody { return doc().body; }
  get readyState(): string { return "complete"; }
  get fonts(): FontFaceSet { return fonts; }

  /* The Fullscreen API's document half. `fullscreenElement` is the canvas
   * when fullscreen and null otherwise, exactly as in a page, so the usual
   * toggle idiom works unchanged:
   *
   *   if (document.fullscreenElement === null) canvas.requestFullscreen();
   *   else document.exitFullscreen();
   */
  get fullscreenElement(): HTMLCanvasElement | null { return fullscreenEl; }
  get fullscreenEnabled(): boolean { return true; }

  exitFullscreen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const rc = ffi.setFullscreen(0);
      queueTask(() => {
        if (rc === 0) { __setFullscreenElement(null); resolve(); }
        else reject(new Error("exiting fullscreen failed"));
      });
    });
  }
}

export const document = new DocumentProxy();

/* ---- window ----
 *
 * `window` is the same object surface a game reaches for: size, rAF, and
 * event registration. It is NOT globalThis here (nothing can be), but for a
 * game's purposes it behaves the same.
 */
export class SgWindow {
  get innerWidth(): number { return ffi.screenWidth(); }
  get innerHeight(): number { return ffi.screenHeight(); }
  devicePixelRatio = 1;
  addEventListener(type: string, listener: (e: KeyboardEvent) => void): void {
    addEventListener(type, listener);
  }
  /** The `load` / `DOMContentLoaded` shape, whose handler takes no event. */
  onLoad(listener: () => void): void { addLoadListener(listener); }
  /** mousemove / mousedown / mouseup. */
  onMouse(type: string, listener: (e: MouseEvent) => void): void {
    addMouseListener(type, listener);
  }
  requestAnimationFrame(cb: FrameCallback): number { return requestAnimationFrame(cb); }
  cancelAnimationFrame(id: number): void { cancelAnimationFrame(id); }
}

export const window = new SgWindow();

/* ---- Math ----
 *
 * Re-exported so a game gets the WHOLE standard surface from one import,
 * without needing to know that the static tier fences sqrt/sin/cos/pow/PI
 * and that those cross to libm. Import it under the standard name:
 *
 *     import { Math } from ".../web/globals.js";
 */
export { SgMath as Math };

/* ---- the Gamepad API types ----
 *
 * These ARE web globals: a browser exposes `Gamepad`, `GamepadButton` and
 * `GamepadHapticActuator` on the global object, and `navigator.getGamepads()`
 * returns them.
 *
 * Deliberately NOT exported: our BTN_A / AXIS_LEFT_X style constants. The
 * web has no such globals -- the Standard Gamepad layout is defined by
 * INDEX, and browser code writes `pad.buttons[0].pressed` and `pad.axes[0]`.
 * A game that wants names defines them itself (simple-jsgame-starter does
 * exactly that in its own utils.js), which keeps the names a game-side
 * choice rather than something a "browser global" has to provide. */
export {
  Gamepad, GamepadButton, GamepadEffectParameters, VibrationActuator,
} from "./input/gamepad.js";

/* ---- the load event ----
 *
 * ES imports are hoisted, so a game's module body runs BEFORE the host can
 * open a window -- the mirror image of a browser, where the page exists
 * first. Rather than pretend otherwise, `load` is the documented place to
 * put anything that needs the canvas:
 *
 *     window.addEventListener("load", () => { ... });   // browser + native
 *
 * The host fires it once, after boot and before the first frame, so the
 * handler sees a live document in both worlds. A game that only calls
 * requestAnimationFrame needs none of this: callbacks already run after
 * boot. */
let loadListeners: (() => void)[] = [];
let loadFired = false;

export function addLoadListener(fn: () => void): void {
  // Registering after the event already fired still runs it, as a browser
  // does for a `load` handler attached to an already-complete document.
  if (loadFired) { queueTask(fn); return; }
  loadListeners.push(fn);
}

/** Host-only: fires `load` once, after the window exists. */
export function __fireLoad(): void {
  if (loadFired) return;
  loadFired = true;
  const batch = loadListeners;
  loadListeners = [];
  for (let i = 0; i < batch.length; i++) batch[i]();
}
