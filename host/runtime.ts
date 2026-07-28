/* The host frame loop: what a browser's event loop does for a page.
 *
 * A game never calls into this. It registers `requestAnimationFrame`
 * callbacks and the host drives them, exactly as a browser drives a page. The
 * old `Game.run(opts)` -- a blocking while-loop the game had to subclass into
 * -- is gone; this file owns the loop instead, and nothing about it appears in
 * game source.
 *
 * Per iteration, in order:
 *   1. pump SDL input (also refreshes gamepad state)
 *   2. dispatch key events to any addEventListener handlers
 *   3. drain the task queue (image onload, fetch resolution, promises)
 *   4. run the frame callbacks registered for this frame
 *   5. present -- this blocks on vsync and is what paces the loop
 *
 * Harness config (SG_MAX_FRAMES, SG_SHOT, SG_NO_VSYNC) is read HERE rather
 * than in game source: a game that reads process.env would not run in a
 * browser, and screenshot plumbing is not a game's concern.
 */
import * as ffi from "./ffi.js";
import { setGameDir } from "./resources.js";
import { usesGLPresent } from "./tasks.js";
import { Input } from "../web/input/input.js";
import {
  __initScreen, __runFrameCallbacks, __hasFrameCallbacks,
  __drainTasks, __hasTasks, __dispatchKeyEvents, __dispatchMouseEvents, __fireLoad,
} from "../web/globals.js";

export class HostOptions {
  width = 640;
  height = 360;
  vsync = true;
  /** 0 = run until quit; >0 = stop after N frames (harness). */
  maxFrames = 0;
  /** When set, the frame at shotFrame is written here as a PNG. */
  shotPath = "";
  shotFrame = 1;
  /** Web root for asset URLs; defaults to the binary's directory. */
  gameDir = ".";
}

export class HostStats {
  frames = 0;
  minMs = 1e9;
  maxMs = 0;
  totalMs = 0;
  hitches = 0;
  displayHz = 0;
  budgetMs = 0;
}

export const stats = new HostStats();

/** Reads the shim's error mailbox as a string. */
function lastError(): string {
  const n = ffi.strLen();
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(ffi.strByte(i));
  return s;
}

/** Options from the environment, so game source never reads process.env. */
export function optionsFromEnv(base: HostOptions): HostOptions {
  const frames = process.env["SG_MAX_FRAMES"];
  if (frames !== undefined) base.maxFrames = parseInt(frames, 10);
  const shot = process.env["SG_SHOT"];
  if (shot !== undefined) base.shotPath = shot;
  const shotFrame = process.env["SG_SHOT_FRAME"];
  if (shotFrame !== undefined) base.shotFrame = parseInt(shotFrame, 10);
  if (process.env["SG_NO_VSYNC"] !== undefined) base.vsync = false;
  return base;
}

/** The game directory: where argv[1] lives, so a binary sits beside assets. */
export function defaultGameDir(): string {
  const argv = process.argv;
  if (argv.length < 2) return ".";
  const exe = argv[1];
  const cut = exe.lastIndexOf("/");
  return cut > 0 ? exe.substring(0, cut) : ".";
}

let input = new Input();
export function hostInput(): Input { return input; }

/**
 * Opens the window and runs until the game quits.
 *
 * Returns a process exit code. The caller is the generated entry, never a
 * game.
 */
/* Opens the window and builds `document`, BEFORE the game module runs.
 *
 * A browser has a DOM before any script executes; this is the equivalent
 * moment. Split from run() so the generated entry can boot, then evaluate
 * the game (whose top level may touch `document`), then start the loop. */
export function boot(opts: HostOptions): number {
  setGameDir(opts.gameDir);

  /* Bit 0 resizable, bit 1 no-vsync.
   *
   * Resizable by default: the canvas keeps its logical size and the renderer
   * integer-scales it with letterboxing, so a game never sees the window
   * size change. Without this the window is pinned to game.json's pixel
   * dimensions, which on a high-DPI display can be a postage stamp. */
  let flags = 1;
  if (!opts.vsync) flags += 2;

  const rc = ffi.init(opts.width, opts.height, flags);
  if (rc !== 0) {
    console.log(`init failed (${rc}): ${lastError()}`);
    return rc;
  }

  // Not fatal: a machine with no joystick support still runs on keyboard.
  const irc = ffi.inputInit();
  if (irc !== 0) console.log(`input init warning (${irc}): ${lastError()}`);

  __initScreen();
  return 0;
}

/* ASYNC on purpose.
 *
 * Promise continuations run when the current synchronous turn ENDS, not when
 * a queue is drained. A plain `for(;;)` loop is one unbroken turn, so a
 * `.then` chain never advances inside it: fetch resolves, and the handler
 * that would decode the audio simply never runs. (Found exactly that way --
 * dodge's music went silent when it moved to fetch + decodeAudioData, with
 * no error anywhere.)
 *
 * `await` at the bottom of each iteration ends the turn, which is precisely
 * what a browser's event loop does between frames. */
export async function run(opts: HostOptions): Promise<number> {
  /* `load` fires once, after the window exists and before the first frame --
   * the moment a browser fires it for a page. Game setup that needs the
   * canvas hangs off this. */
  __fireLoad();

  /* The frame budget is the DISPLAY's, not the simulation's. With vsync on,
   * present blocks until scanout, so a 30Hz panel makes 33ms the correct
   * frame time and calling it a hitch would be a lie. */
  const hz = ffi.displayHz();
  stats.displayHz = hz;
  stats.budgetMs = opts.vsync && hz > 0 ? 1000 / hz : 1000 / 60;

  let last = ffi.ticks();
  let lastMouseX = -1;
  let lastMouseY = -1;

  for (;;) {
    input.pump();
    if (input.quitRequested) break;

    __dispatchKeyEvents(input);
    __dispatchMouseEvents(input, lastMouseX, lastMouseY);
    lastMouseX = input.mouseX;
    lastMouseY = input.mouseY;

    // Asset callbacks and promise continuations land before the frame that
    // observes them, which is the ordering a browser gives.
    __drainTasks();

    const now = ffi.ticks();
    let frameMs = now - last;
    last = now;
    if (frameMs > 250) frameMs = 250;   // never spiral after a window drag

    /* Fit the GL viewport to the window BEFORE the game draws, so a
     * resize is reflected in the same frame rather than one late.
     *
     * The 2D path gets this from SDL_RenderSetLogicalSize; GL renders
     * straight into the back buffer, so without this the viewport keeps
     * its startup size and maximising the window reveals empty
     * framebuffer around an unchanged image. Letterboxed, so the game
     * keeps its aspect at any window size.
     *
     * A game that calls renderer.setSize() itself will overwrite the
     * viewport, which is correct: it then owns the decision. */
    if (usesGLPresent()) ffi.glFitViewport(opts.width, opts.height);

    __runFrameCallbacks(now);

    if (opts.shotPath !== "" && stats.frames + 1 === opts.shotFrame) {
      /* A GL frame lives in the GL framebuffer, not in the Skia surface,
       * so capturing a WebGL game through the 2D path yields a blank image.
       * That actually happened, and a zero exit code hid it. */
      const src = usesGLPresent()
        ? ffi.glSavePng(opts.shotPath)
        : ffi.surfaceSavePng(0, opts.shotPath);
      if (src !== 0) console.log(`screenshot failed (${src}): ${lastError()}`);
      else console.log(`screenshot: ${opts.shotPath}`);
    }

    /* A GL frame is already in the window's back buffer, so it presents
     * with a swap; the 2D path blits a Skia raster surface instead. */
    const prc = usesGLPresent() ? ffi.glPresent() : ffi.present();
    if (prc !== 0) {
      console.log(`present failed (${prc}): ${lastError()}`);
      break;
    }

    stats.frames += 1;
    stats.totalMs += frameMs;
    if (stats.frames > 1) {           // frame 1's delta includes startup
      if (frameMs < stats.minMs) stats.minMs = frameMs;
      if (frameMs > stats.maxMs) stats.maxMs = frameMs;
      if (frameMs > stats.budgetMs * 1.5) stats.hitches += 1;
    }

    if (opts.maxFrames > 0 && stats.frames >= opts.maxFrames) break;

    /* End the turn so promise continuations run before the next frame. This
     * one line is what makes `fetch().then()` and `img.decode()` work. */
    await Promise.resolve(0);
  }

  ffi.inputQuit();
  ffi.quit();
  return 0;
}
