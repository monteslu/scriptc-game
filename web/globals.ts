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
import { GameImage, decodeImage } from "./canvas/image.js";
import { Input } from "./input/input.js";
import { Gamepad, gamepads as sparseGamepads } from "./input/gamepad.js";
import { resolveUrl, readBinary, fileExists } from "../host/resources.js";

/* ---- the task queue ----
 *
 * One queue serves rAF, `setTimeout(fn, 0)`-style deferral, and every async
 * shim, so "later turn" means the same thing everywhere and the host drains
 * it in one place.
 */
type Task = () => void;
let tasks: Task[] = [];

/** Runs `fn` on a later turn. The single primitive the async rule rests on. */
export function queueTask(fn: Task): void {
  tasks.push(fn);
}

/** Drains queued tasks. Host-only; a game never calls this. */
export function __drainTasks(): void {
  // Swap-then-run so a task queueing another task does not spin forever
  // inside one drain: the new work lands on the next drain, like a browser.
  const batch = tasks;
  tasks = [];
  for (let i = 0; i < batch.length; i++) batch[i]();
}

export function __hasTasks(): boolean { return tasks.length > 0; }

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

/* ---- navigator ---- */

export class SgNavigator {
  /** Slot-indexed with nulls for gaps, like the real getGamepads(). */
  getGamepads(): (Gamepad | null)[] { return sparseGamepads(); }
  userAgent = "scriptc-game";
}

export const navigator = new SgNavigator();

/* ---- Image ----
 *
 * `new Image()`, set `.src`, get `onload`. The decode is synchronous
 * underneath, but the callback fires from the task queue so attaching
 * `onload` AFTER setting `src` still works -- which is how most real code is
 * written.
 */
export class Image {
  width = 0;
  height = 0;
  complete = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** The decoded bitmap; drawImage takes this. */
  bitmap: GameImage | null = null;
  private srcUrl = "";

  get src(): string { return this.srcUrl; }

  set src(url: string) {
    this.srcUrl = url;
    const path = resolveUrl(url);
    // Decode NOW (it is a native call) but report LATER, so ordering matches
    // a browser: the assignment returns before any handler runs.
    const bytes = readBinary(path);
    if (bytes === null) {
      queueTask(() => {
        if (this.onerror !== null) this.onerror();
      });
      return;
    }
    const img = decodeImage(bytes);
    if (!img.valid) {
      queueTask(() => {
        if (this.onerror !== null) this.onerror();
      });
      return;
    }
    this.bitmap = img;
    this.width = img.width;
    this.height = img.height;
    queueTask(() => {
      this.complete = true;
      if (this.onload !== null) this.onload();
    });
  }

  /** The modern promise form. Settles on a later turn, as the spec requires. */
  decode(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      queueTask(() => {
        if (this.bitmap !== null) resolve();
        else reject(new Error(`could not decode ${this.srcUrl}`));
      });
    });
  }
}

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

export function fetch(url: string): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const path = resolveUrl(url);
    const bytes = readBinary(path);
    // Resolves on a later turn even though the read already happened.
    queueTask(() => { resolve(new Response(url, bytes)); });
  });
}

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
  requestAnimationFrame(cb: FrameCallback): number { return requestAnimationFrame(cb); }
  cancelAnimationFrame(id: number): void { cancelAnimationFrame(id); }
}

export const window = new SgWindow();

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
