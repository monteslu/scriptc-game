/* The frame loop.
 *
 * The framework OWNS the loop; there is no requestAnimationFrame to
 * emulate and no callback ever crosses the FFI. Fixed-timestep update with
 * an accumulator, interpolated draw, vsync present as the pacer.
 */
import * as ffi from "../ffi.js";
import { Context2D } from "../canvas/context.js";
import { Input, EV_NONE, F_SCANCODE, F_REPEAT, F_X, F_Y } from "../input/input.js";

export class Stats {
  frames = 0;
  minMs = 1e9;
  maxMs = 0;
  totalMs = 0;
  /** Frames slower than 1.5x the PRESENT budget: the "hitch" count. */
  hitches = 0;
  /** Display refresh in Hz (0 = unknown/headless), and the ms budget it implies. */
  displayHz = 0;
  budgetMs = 0;
}

export class GameOptions {
  width = 640;
  height = 360;
  fixedStepMs = 1000 / 60;
  /** 0 = run forever (until quit); >0 = stop after N frames (tests). */
  maxFrames = 0;
  vsync = true;
  /** When set, the frame at `shotFrame` is written here as a PNG. */
  shotPath = "";
  shotFrame = 1;
}

/** Reads the shim's error mailbox as a string. */
export function lastError(): string {
  const n = ffi.strLen();
  let s = "";
  for (let i = 0; i < n; i++) {
    s += String.fromCharCode(ffi.strByte(i));
  }
  return s;
}

export class Game {
  ctx: Context2D | null = null;
  input = new Input();
  stats = new Stats();
  private running = false;

  /** Override in a subclass, or assign before run(). */
  update(_dtMs: number): void {}
  draw(_ctx: Context2D, _alpha: number): void {}

  run(opts: GameOptions): number {
    let flags = 0;
    if (!opts.vsync) flags += 2;

    let rc = ffi.init(opts.width, opts.height, flags);
    if (rc !== 0) {
      console.log(`init failed (${rc}): ${lastError()}`);
      return rc;
    }

    let canvasHandle = ffi.screenCanvas();
    if (canvasHandle === 0) {
      console.log("no screen canvas");
      ffi.quit();
      return -1;
    }

    this.ctx = new Context2D(canvasHandle);
    this.running = true;

    /* The frame budget is the DISPLAY's, not the simulation's. With vsync
     * on, present blocks until scanout, so a 30Hz panel makes 33ms the
     * correct frame time and calling it a hitch would be a lie. The fixed
     * update step stays at fixedStepMs regardless; the accumulator is what
     * decouples simulation rate from refresh rate. */
    const hz = ffi.displayHz();
    this.stats.displayHz = hz;
    let budget = opts.fixedStepMs;
    if (opts.vsync && hz > 0) budget = 1000 / hz;
    this.stats.budgetMs = budget;

    let last = ffi.ticks();
    let acc = 0;
    const step = opts.fixedStepMs;

    while (this.running) {
      this.input.beginFrame();
      let kind = ffi.pollEvent();
      while (kind !== EV_NONE) {
        this.input.handle(
          kind,
          ffi.evtI32(F_SCANCODE),
          ffi.evtI32(F_REPEAT),
          ffi.evtI32(F_X),
          ffi.evtI32(F_Y),
        );
        kind = ffi.pollEvent();
      }
      if (this.input.quitRequested) break;

      let now = ffi.ticks();
      let frameMs = now - last;
      last = now;
      // A huge delta (window drag, breakpoint) must not spiral the
      // accumulator into a death loop of catch-up updates.
      if (frameMs > 250) frameMs = 250;
      acc += frameMs;

      let guard = 0;
      while (acc >= step && guard < 8) {
        this.update(step);
        acc -= step;
        guard += 1;
      }

      this.draw(this.ctx, acc / step);

      // Captured after draw and before present: the surface holds exactly
      // the frame the window is about to show, so a headless run and a
      // windowed run save identical pixels.
      if (opts.shotPath !== "" && this.stats.frames + 1 === opts.shotFrame) {
        const src = ffi.surfaceSavePng(opts.shotPath);
        if (src !== 0) console.log(`screenshot failed (${src}): ${lastError()}`);
        else console.log(`screenshot: ${opts.shotPath}`);
      }

      rc = ffi.present();
      if (rc !== 0) {
        console.log(`present failed (${rc}): ${lastError()}`);
        break;
      }

      // stats
      const st = this.stats;
      st.frames += 1;
      st.totalMs += frameMs;
      if (st.frames > 1) { // frame 1's delta includes startup
        if (frameMs < st.minMs) st.minMs = frameMs;
        if (frameMs > st.maxMs) st.maxMs = frameMs;
        if (frameMs > budget * 1.5) st.hitches += 1;
      }

      if (opts.maxFrames > 0 && st.frames >= opts.maxFrames) break;
    }

    if (this.ctx !== null) this.ctx.dispose();
    ffi.quit();
    return 0;
  }

  stop(): void { this.running = false; }
}
